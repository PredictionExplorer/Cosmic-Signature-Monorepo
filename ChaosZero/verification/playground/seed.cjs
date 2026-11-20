"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const gameRequire = require("node:module").createRequire(
  path.join(process.env.COSMIC_CONTRACTS_DIR, "package.json"),
);
const hre = gameRequire("hardhat");
const { deployContractsForTestingAdvanced } = gameRequire("./src/ContractTestingHelpers");
const { activateRoundBidAndClaimMainPrize } = gameRequire("./test/src/GameRoundTestHelpers");
const { upgradeToV2, mineAtOrAfter } = gameRequire("./test/src/V2UpgradeTestHelpers");
const { upgradeToV3 } = gameRequire("./test/src/V3UpgradeTestHelpers");
const { deployArtAuction } = gameRequire("./test/src/V4UpgradeTestHelpers");

async function deployChaosContract(name, owner, ...args) {
  const artifact = JSON.parse(
    await fs.readFile(path.join(__dirname, "../../out", name + ".sol", name + ".json"), "utf8"),
  );
  const contract = await new hre.ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode.object,
    owner,
  ).deploy(...args);
  return contract.waitForDeployment();
}

// The browser rehearsal creates its own first V4 batch. Interactive sessions play that
// cycle in historical chain time so all eight lots are already eligible when the sites open.
async function prepareInteractiveCycle(contracts, game, cst, market, auction) {
  const previousCycle = await game.roundNum();
  const participant = contracts.signers[1];
  const claim = hre.ethers.parseEther("10");
  await (await cst.connect(participant).approve(market.target, claim)).wait();
  await (await market.connect(participant).splitPosition(previousCycle, 0, claim)).wait();
  await activateRoundBidAndClaimMainPrize(contracts, game);
  const liveCycle = await game.roundNum();

  const pace = JSON.parse(process.env.V4_PLAYGROUND_FAST_PACE);
  const incrementMicros = BigInt(pace.timeIncrementSeconds) * 1_000_000n;
  const ownerGame = game.connect(contracts.ownerSigner);
  await (await ownerGame.setMainPrizeTimeIncrementInMicroSeconds(incrementMicros)).wait();
  // Keep the selected local pace stable across successive cycle closes.
  await (await ownerGame.setMainPrizeTimeIncrementIncreaseDivisor(hre.ethers.MaxUint256)).wait();
  await (
    await ownerGame.setInitialDurationUntilMainPrizeDivisor(
      incrementMicros / BigInt(pace.initialCountdownSeconds),
    )
  ).wait();
  await (
    await ownerGame.setEthDutchAuctionDurationDivisor(
      incrementMicros / BigInt(pace.ethWindowSeconds),
    )
  ).wait();
  await (await ownerGame.setDelayDurationBeforeRoundActivation(pace.activationDelaySeconds)).wait();
  await (
    await ownerGame.setTimeoutDurationToClaimMainPrize(pace.finalizeExclusivitySeconds)
  ).wait();
  await (
    await contracts.prizesWallet
      .connect(contracts.ownerSigner)
      .setTimeoutDurationToWithdrawPrizes(pace.retrievalTimeoutSeconds)
  ).wait();

  // Fund the six local test wallets from CST earned in the earlier cycles. The market's
  // grant and its settlement vault are separate from the participant's wallet balance.
  const listWallets = (indices) =>
    indices.map((index) => ({ index, address: contracts.signers[index].address }));
  const humanWallets = listWallets([1, 2, 3]);
  const botWallets = listWallets([7, 8, 9]);
  const wallets = [...humanWallets, ...botWallets];
  const starterCst = hre.ethers.parseEther("1000");
  await (
    await cst.connect(participant)["transferMany(address[],uint256)"](
      wallets.slice(1).map((wallet) => wallet.address),
      starterCst,
    )
  ).wait();

  await (await market.syncFunding(liveCycle)).wait();
  const [claimable, amount] = await market.previewClaim(previousCycle, participant.address);
  assert.ok(claimable && amount === claim, "First human's earlier position must remain redeemable");
  const pools = await market.questionStates(liveCycle);
  assert.equal(pools.length, 8);
  for (const pool of pools) {
    // The first cycle's unused 1,000 CST per question carries into the live grant.
    assert.equal(pool.activeCollateral, hre.ethers.parseEther("2000"));
  }
  assert.equal(await game.getMainPrizeTimeIncrement(), BigInt(pace.timeIncrementSeconds));
  assert.equal(await game.getInitialDurationUntilMainPrize(), BigInt(pace.initialCountdownSeconds));
  for (const { address } of wallets) {
    assert.ok((await cst.balanceOf(address)) >= starterCst, "Missing participant CST balance");
    assert.ok(
      (await hre.ethers.provider.getBalance(address)) >= hre.ethers.parseEther("1000"),
      "Missing participant ETH balance",
    );
  }
  const first = await auction.firstNftIdByBatchIndex(0);
  const lot = await auction.getAuction(first);
  assert.equal(lot.roundNum, previousCycle);
  assert.equal(await auction.registeredBatchCount(), 1n);
  await mineAtOrAfter(lot.eligibleAt);
  const { instanceId } = await hre.network.provider.send("hardhat_metadata");
  return { humanWallets, botWallets, firstAuctionTokenId: first.toString(), instanceId };
}

async function main() {
  assert.equal(hre.network.name, "hardhat_on_localhost");
  assert.equal(new URL(hre.network.config.url).hostname, "127.0.0.1");
  assert.equal((await hre.ethers.provider.getNetwork()).chainId, 31337n);
  assert.match(await hre.network.provider.send("web3_clientVersion"), /^HardhatNetwork\//);
  const contracts_ = await deployContractsForTestingAdvanced("CosmicSignatureGame");
  await activateRoundBidAndClaimMainPrize(contracts_, contracts_.cosmicSignatureGameProxy);
  await upgradeToV2(contracts_);
  await activateRoundBidAndClaimMainPrize(contracts_, contracts_.cosmicSignatureGameV2Proxy);
  await upgradeToV3(contracts_);
  const v3_ = contracts_.cosmicSignatureGameV3Proxy;
  await activateRoundBidAndClaimMainPrize(contracts_, v3_);
  const cst_ = contracts_.cosmicSignatureToken;
  const cycle = await v3_.roundNum();
  const stats = await v3_.roundStats(cycle - 1n);
  assert.ok(stats.totalSpentEthAmount > 0n, "Outcome baseline must come from a played V3 cycle");
  const owner = contracts_.ownerSigner;
  const source = await deployChaosContract("V3OutcomeSource", owner, v3_.target, cycle, [
    stats.numBids,
    stats.totalSpentEthAmount,
    stats.totalSpentCstAmount,
    stats.maxCstBidPrice,
    stats.enduranceChampionDuration,
    stats.chronoWarriorDuration,
    (stats.flags & 4n) !== 0n,
  ]);
  const market = await deployChaosContract(
    "GameFundedOutcomeMarket",
    owner,
    cst_.target,
    source.target,
    v3_.target,
  );
  const previous_ = await deployChaosContract(
    "IndependentOutcomeMarket",
    owner,
    cst_.target,
    source.target,
  );
  const auction = await deployArtAuction(contracts_);
  const factory_ = await hre.ethers.getContractFactory(
    "CosmicSignatureGameV4",
    contracts_.ownerSigner,
  );
  const game_ = await hre.upgrades.upgradeProxy(v3_.target, factory_, {
    kind: "uups",
    call: { fn: "initializeV4", args: [auction.target, market.target] },
  });
  await game_.waitForDeployment();
  assert.equal(await game_.roundNum(), 3n);
  assert.equal(await cst_.balanceOf(market.target), hre.ethers.parseEther("8000"));
  const interactive =
    process.env.V4_PLAYGROUND_INTERACTIVE === "1"
      ? await prepareInteractiveCycle(contracts_, game_, cst_, market, auction)
      : {};
  const cycle_ = await game_.roundNum();
  // Anchor the active cycle near wall time after producing the earlier history.
  const latest_ = await hre.ethers.provider.getBlock("latest");
  const activation_ = Math.max(latest_.timestamp + 3, Math.floor(Date.now() / 1000));
  await (await game_.connect(contracts_.ownerSigner).setRoundActivationTime(activation_)).wait();
  await mineAtOrAfter(BigInt(activation_));
  if (process.env.V4_PLAYGROUND_VERIFY_SEED === "1") {
    assert.ok(
      interactive.humanWallets,
      "The interactive wallet smoke requires the interactive seed",
    );
    await require("./verify-interactive-seed.cjs")(contracts_, game_, market, auction, interactive);
  }
  const actor_ = contracts_.signers[1].address;
  assert.ok(
    (await cst_.balanceOf(actor_)) >= hre.ethers.parseEther("10"),
    "The returning participant must have earned CST",
  );
  const implementation_ = await hre.upgrades.erc1967.getImplementationAddress(game_.target);
  const addresses_ = Object.fromEntries(
    Object.entries(contracts_).filter(
      ([name_, value_]) => name_.endsWith("Address") && hre.ethers.isAddress(value_),
    ),
  );
  addresses_.cosmicSignatureGameImplementationAddress = implementation_;
  const file_ = process.env.V4_PLAYGROUND_MANIFEST;
  await fs.writeFile(
    path.join(path.dirname(file_), "deploy-report.json"),
    JSON.stringify(addresses_),
  );
  await fs.writeFile(
    file_,
    JSON.stringify(
      {
        rpcUrl: hre.network.config.url,
        apiUrl: "http://127.0.0.1:" + process.env.HARNESS_API_PORT,
        cosmicUrl: "http://localhost:" + process.env.HARNESS_WEB_PORT,
        game: game_.target,
        cst: cst_.target,
        nft: contracts_.cosmicSignatureNftAddress,
        market: market.target,
        previousMarket: previous_.target,
        auction: auction.target,
        source: source.target,
        auctionDeploymentBlock: (await auction.deploymentTransaction().wait()).blockNumber,
        auctionCodeHash: hre.ethers.keccak256(await hre.ethers.provider.getCode(auction.target)),
        cycle: Number(cycle_),
        actor: actor_,
        ...interactive,
      },
      null,
      2,
    ),
  );
  if (process.env.V4_PLAYGROUND_VERIFY_SEED === "1") {
    const { verifyBots } = await import("./verify-bots.mjs");
    await verifyBots(JSON.parse(await fs.readFile(file_, "utf8")));
  }
}

main().catch((error_) => {
  console.error(error_);
  process.exitCode = 1;
});
