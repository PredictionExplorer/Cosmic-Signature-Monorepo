"use strict";

const { expect } = require("chai");
const hre = require("hardhat");
const { snapshotV3Storage } = require("../V4UpgradeTestHelpers.js");
const { deployV4Companions } = require("../V4CompanionTestHelpers.js");
const { CST_PER_V4_CYCLE } = require("./GameModel.js");

/**
 * Put genuine V1 rewards in a funded, passive account for the duration of the upgrades.
 * Ordinary fuzz actions can then transfer and stake the other assets without consuming this history.
 */
async function saveV1Rewards(ctx_) {
	const { contracts, actors, engine, ledger } = ctx_;
	const eligible_ = actors.filter((actor_) => engine.canAfford(actor_.address) &&
		ledger.cstBalanceOf(actor_.address) > 0n && ledger.nftIdsOwnedBy("cs", actor_.address).length > 0);
	expect(eligible_, "a V1 participant must hold earned CST and a Cosmic Signature NFT").not.to.be.empty;
	const actor_ = engine.pick(eligible_);
	const holder_ = contracts.deployerSigner;
	const balance_ = ledger.cstBalanceOf(actor_.address);
	const amount_ = engine.randomBigIntRange(1n, balance_ < 10n ** 18n ? balance_ : 10n ** 18n);
	const nftId_ = BigInt(engine.pick(ledger.nftIdsOwnedBy("cs", actor_.address)));
	engine.expectOk(await engine.execTx({
		signer: actor_.signer,
		buildTx: (overrides_) => contracts.cosmicSignatureToken.connect(actor_.signer).transfer(holder_.address, amount_, overrides_),
	}), "hold V1 CST");
	engine.expectOk(await engine.execTx({
		signer: actor_.signer,
		buildTx: (overrides_) => contracts.cosmicSignatureNft.connect(actor_.signer).transferFrom(actor_.address, holder_.address, nftId_, overrides_),
	}), "hold V1 NFT");
	return { holder: holder_, amount: amount_, nftId: nftId_ };
}

async function useV1Rewards(ctx_, rewards_) {
	const { contracts, engine } = ctx_;
	const { holder, amount, nftId } = rewards_;
	const recipient_ = engine.pick(ctx_.actors).address;
	const cst_ = contracts.cosmicSignatureToken;
	const nft_ = contracts.cosmicSignatureNft;
	const before_ = await cst_.balanceOf(recipient_);
	expect(await nft_.ownerOf(nftId), "V1 NFT custody at V4").to.equal(holder.address);
	engine.expectOk(await engine.execTx({
		signer: holder,
		buildTx: (overrides_) => cst_.connect(holder).transfer(recipient_, amount, overrides_),
	}), "spend V1 CST on V4");
	engine.expectOk(await engine.execTx({
		signer: holder,
		buildTx: (overrides_) => nft_.connect(holder).transferFrom(holder.address, recipient_, nftId, overrides_),
	}), "transfer V1 NFT on V4");
	expect(await cst_.balanceOf(recipient_) - before_, "V1 CST received on V4").to.equal(amount);
	expect(await nft_.ownerOf(nftId), "V1 NFT received on V4").to.equal(recipient_);
}

/** Use the recipient's outstanding ETH allocation from the latest V3 cycle on the upgraded game. */
async function retrieveV3Allocation(ctx_, round_, actor_, amount_) {
	const { contracts, engine, ledger } = ctx_;
	const wallet_ = contracts.prizesWallet.connect(actor_.signer);
	expect(await wallet_["getEthBalanceAmount(uint256,address)"](round_, actor_.address)).to.equal(amount_);
	engine.expectOk(await engine.execTx({
		signer: actor_.signer,
		buildTx: (overrides_) => wallet_["withdrawEth(uint256)"](round_, overrides_),
	}), "retrieve V3 allocation after V4 upgrade");
	ledger.addEth(actor_.address, amount_);
	ledger.addEth(contracts.prizesWalletAddress, -amount_);
	await ledger.verifyDirtyEth();
	expect(await wallet_["getEthBalanceAmount(uint256,address)"](round_, actor_.address)).to.equal(0n);
}

/** Upgrade the existing UUPS proxy and initialize it in the same owner transaction. */
async function performUpgradeToV4(ctx_) {
	const { contracts, engine, ledger, model } = ctx_;
	const owner_ = contracts.ownerSigner;
	const proxy_ = contracts.cosmicSignatureGameProxyAddress;
	const previous_ = ctx_.game.contract;
	const activation_ = engine.lastTs + 86400n;
	engine.expectOk(await engine.execTx({
		signer: owner_,
		buildTx: (overrides_) => previous_.connect(owner_).setRoundActivationTime(activation_, overrides_),
	}), "reserve the inactive V4 upgrade window");
	model.roundActivationTime = activation_;

	const companions_ = await deployV4Companions(previous_, owner_);
	const factory_ = await hre.ethers.getContractFactory("CosmicSignatureGameV4", owner_);
	const implementation_ = await hre.upgrades.prepareUpgrade(proxy_, factory_, { kind: "uups" });
	await engine.resyncTime();
	await ledger.resyncEth(owner_.address);
	await ledger.trackEth(companions_.auction.target, "artAuction");
	const slots_ = await snapshotV3Storage(proxy_);
	const previousRound_ = model.roundNum - 1n;
	const previousStats_ = await previous_.roundStats(previousRound_);
	const supply_ = await contracts.cosmicSignatureToken.totalSupply();
	const nftSupply_ = await contracts.cosmicSignatureNft.totalSupply();
	const game_ = factory_.attach(proxy_);
	const init_ = factory_.interface.encodeFunctionData("initializeV4", [companions_.auction.target, companions_.market.target]);
	const receipt_ = engine.expectOk(await engine.execTx({
		signer: owner_,
		buildTx: (overrides_) => previous_.connect(owner_).upgradeToAndCall(implementation_, init_, overrides_),
	}), "atomic V3 to V4 upgrade");

	expect(await hre.upgrades.erc1967.getImplementationAddress(proxy_)).to.equal(implementation_);
	expect(await snapshotV3Storage(proxy_), "all pre-V4 scalar storage slots").to.deep.equal(slots_);
	expect(await game_.roundStats(previousRound_), "completed V3 statistics").to.deep.equal(previousStats_);
	expect(await game_.owner()).to.equal(owner_.address);
	expect(await game_.artAuction()).to.equal(companions_.auction.target);
	expect(await game_.chaosZeroMarket()).to.equal(companions_.market.target);
	expect(await contracts.cosmicSignatureNft.totalSupply(), "no auction NFTs before first V4 close").to.equal(nftSupply_);
	expect(await contracts.cosmicSignatureToken.totalSupply() - supply_).to.equal(CST_PER_V4_CYCLE);
	expect(await game_.chaosZeroFunding(companions_.market.target, model.roundNum)).to.deep.equal([CST_PER_V4_CYCLE, CST_PER_V4_CYCLE]);
	expect(engine.singleEvent(receipt_, game_, "ChaosZeroCycleFunded", "initializeV4").args)
		.to.deep.equal([companions_.market.target, model.roundNum, CST_PER_V4_CYCLE, CST_PER_V4_CYCLE]);
	ctx_.rebindGame(game_, 4);
	ctx_.v4Companions = companions_;
	model.version = 4;
	return companions_;
}

module.exports = { saveV1Rewards, useV1Rewards, retrieveV3Allocation, performUpgradeToV4 };
