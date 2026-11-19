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
  const cycle_ = await game_.roundNum();
  assert.equal(cycle_, 3n);
  assert.equal(await cst_.balanceOf(market.target), hre.ethers.parseEther("8000"));
  // Anchor the interactive cycle near wall time after producing the earlier history.
  const latest_ = await hre.ethers.provider.getBlock("latest");
  const activation_ = Math.max(latest_.timestamp + 3, Math.floor(Date.now() / 1000));
  await (await game_.connect(contracts_.ownerSigner).setRoundActivationTime(activation_)).wait();
  await mineAtOrAfter(BigInt(activation_));
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
      },
      null,
      2,
    ),
  );
}

main().catch((error_) => {
  console.error(error_);
  process.exitCode = 1;
});
