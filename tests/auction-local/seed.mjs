import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

async function main() {
  const root = process.env.COSMIC_CONTRACT_ROOT;
  const load = createRequire(resolve(root, "package.json"));
  const hre = load("hardhat");
  assert.equal(hre.network.name, "hardhat_on_localhost");
  assert.equal(hre.network.config.url, "http://127.0.0.1:8559");
  assert.equal(await hre.network.provider.send("eth_chainId"), "0x7a69");
  assert.match(
    await hre.network.provider.send("web3_clientVersion"),
    /^HardhatNetwork\//,
  );
  const { deployV4Fixture } = load(
    resolve(root, "test/src/V4UpgradeTestHelpers.js"),
  );
  const { activateRoundBidAndClaimMainPrize } = load(
    resolve(root, "test/src/GameRoundTestHelpers.js"),
  );
  const { findParsedEvent } = load(
    resolve(root, "test/src/V2UpgradeTestHelpers.js"),
  );

  if (process.argv.includes("--next-batch")) {
    const first = JSON.parse(
      await readFile(process.env.AXIOM_AUCTION_FIXTURE, "utf8"),
    );
    const game = await hre.ethers.getContractAt(
      "CosmicSignatureGameV4",
      first.game,
    );
    const auction = await hre.ethers.getContractAt(
      "CosmicSignatureArtAuction",
      first.auction,
    );
    const owner = await game.owner();
    // The fixture deploys with a disposable owner wallet in a separate process.
    await hre.network.provider.send("hardhat_impersonateAccount", [owner]);
    const ownerSigner = await hre.ethers.getSigner(owner);
    const signers = await hre.ethers.getSigners();
    const signerAddressToIndexMapping = Object.fromEntries(
      signers.map((signer, index) => [signer.address, index]),
    );
    // Auction tests may have advanced past activation. This empty game cycle
    // can be postponed before setting the floor for its future auction batch.
    const block = await hre.ethers.provider.getBlock("latest");
    await (
      await game
        .connect(ownerSigner)
        .setRoundActivationTime(block.timestamp + 600)
    ).wait();
    await (
      await game.connect(ownerSigner).setArtAuctionOpeningBid(2n * 10n ** 15n)
    ).wait();
    const close = await activateRoundBidAndClaimMainPrize(
      { ownerSigner, signers, signerAddressToIndexMapping },
      game,
    );
    const registration = findParsedEvent(
      close,
      auction,
      "AuctionBatchRegistered",
    );
    assert.equal(registration.args.openingBid, 2n * 10n ** 15n);
    await writeFile(
      process.env.AXIOM_AUCTION_FIXTURE + ".next",
      JSON.stringify({
        firstTokenId: Number(registration.args.firstNftId),
        eligibleAt: Number(registration.args.eligibleAt),
      }),
    );
    return;
  }
  const fixture = await deployV4Fixture();
  const auction = fixture.cosmicSignatureArtAuction;
  const game = fixture.cosmicSignatureGameV4Proxy;
  const nft = fixture.cosmicSignatureNft;
  const close = await activateRoundBidAndClaimMainPrize(fixture, game);
  const registration = findParsedEvent(
    close,
    auction,
    "AuctionBatchRegistered",
  );
  assert.equal(registration.args.count, 8n);
  assert.equal(registration.args.openingBid, 10n ** 15n);
  const deployment = await auction.deploymentTransaction().wait();
  const result = {
    rpc: "http://127.0.0.1:8559",
    chainId: 31337,
    auction: auction.target,
    game: game.target,
    nft: nft.target,
    codeHash: hre.ethers.keccak256(
      await hre.ethers.provider.getCode(auction.target),
    ),
    deploymentBlock: deployment.blockNumber,
    firstTokenId: Number(registration.args.firstNftId),
    eligibleAt: Number(registration.args.eligibleAt),
    accounts: (await hre.ethers.getSigners())
      .slice(1, 4)
      .map((signer) => signer.address),
  };
  await writeFile(process.env.AXIOM_AUCTION_FIXTURE, JSON.stringify(result));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
