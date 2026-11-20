"use strict";

const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const gameRequire = createRequire(path.join(process.env.COSMIC_CONTRACTS_DIR, "package.json"));
const hre = gameRequire("hardhat");
const { waitForTransactionReceipt: confirm } = gameRequire("./src/Helpers");
const { bidWithEthAt } = gameRequire("./test/src/GameRoundTestHelpers");
const { getLatestBlockTimestamp, mineAtOrAfter } = gameRequire("./test/src/V2UpgradeTestHelpers");

// Runs only during disposable startup verification, before indexing begins. Restore the
// actual seeded state, including chain time and wallet balances, for the browser checks.
module.exports = async function verifyInteractiveSeed(contracts, game, market, auction, manifest) {
  const snapshot = await hre.network.provider.send("evm_snapshot");
  const cycle = await game.roundNum();
  const [alice, bob] = manifest.humanWallets.map(({ index }) => contracts.signers[index]);
  const token = contracts.cosmicSignatureToken;
  try {
    // The first two gestures exercise the opening countdown and the short increment.
    const first = await bidWithEthAt(game, alice, (await getLatestBlockTimestamp()) + 1n);
    const end = await game.mainPrizeTime();
    assert.equal(
      end - BigInt((await first.getBlock()).timestamp),
      await game.getInitialDurationUntilMainPrize(),
    );
    await bidWithEthAt(game, bob, (await getLatestBlockTimestamp()) + 1n);
    assert.equal(await game.mainPrizeTime(), end + (await game.getMainPrizeTimeIncrement()));

    const cost = hre.ethers.parseEther("1");
    const units = hre.ethers.parseEther("1.5");
    await confirm(token.connect(bob).approve(market.target, cost));
    await confirm(
      market.connect(bob).buy(cycle, 0, true, cost, units, (await getLatestBlockTimestamp()) + 60n),
    );
    assert.equal(
      await market.balanceOf(bob.address, await market.positionId(cycle, 0, true)),
      units,
    );

    const lot = BigInt(manifest.firstAuctionTokenId);
    const opening = await auction.minimumNextBid(lot);
    await confirm(auction.connect(alice).bid(lot, opening, { value: opening }));
    const next = await auction.minimumNextBid(lot);
    await confirm(auction.connect(bob).bid(lot, next, { value: next }));
    assert.equal(await auction.refundCredits(alice.address), opening);
    await confirm(auction.connect(alice).withdrawRefund(alice.address));

    await mineAtOrAfter(await game.mainPrizeTime());
    await confirm(game.connect(bob).claimMainPrize());
    const upcoming = await game.roundNum();
    assert.equal(upcoming, cycle + 1n);
    assert.equal(await auction.registeredBatchCount(), 2n);
    const totals = await market.consumedGameFunding();
    await confirm(market.syncFunding(upcoming));
    await confirm(market.syncFunding(upcoming));
    assert.equal(await market.consumedGameFunding(), totals + hre.ethers.parseEther("8000"));
    const collateral = await market.totalActiveCollateral();
    const before = await token.balanceOf(alice.address);
    await confirm(market.connect(alice).claimKnown(cycle - 1n));
    assert.equal((await token.balanceOf(alice.address)) - before, hre.ethers.parseEther("10"));
    assert.equal(await market.totalActiveCollateral(), collateral);

    await mineAtOrAfter((await auction.getAuction(lot)).endAt);
    await confirm(auction.settle(lot));
    await confirm(auction.connect(bob).claimNft(lot, bob.address));
    await confirm(auction.forwardProceeds(lot));
    assert.equal(await contracts.cosmicSignatureNft.ownerOf(lot), bob.address);
    assert.equal(await auction.totalLiabilities(), 0n);
  } finally {
    assert.ok(
      await hre.network.provider.send("evm_revert", [snapshot]),
      "Failed to restore V4 seed",
    );
  }
  assert.equal(await game.roundNum(), cycle);
  assert.equal(await auction.registeredBatchCount(), 1n);
  console.log(
    "Verified interactive wallet transactions, fast cycles, prior claims and auction settlement.",
  );
};
