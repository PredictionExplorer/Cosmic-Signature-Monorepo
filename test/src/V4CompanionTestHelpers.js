"use strict";

const { expect } = require("chai");
const hre = require("hardhat");
const { readChaosZeroArtifact } = require("../../tasks/src/rehearse-v4-chaos-zero.js");
const { expectSolvent, MINIMUM_BID, ELIGIBILITY_DELAY, AUCTION_DURATION, EXTENSION_DURATION } = require("./ArtAuctionTestHelpers.js");

const UNIT = 10n ** 18n;
const GRANT = 8_000n * UNIT;
const QUESTIONS = 8;

async function deployChaosZeroContract(name_, signer_, ...args_) {
	const artifact_ = readChaosZeroArtifact(name_);
	const factory_ = new hre.ethers.ContractFactory(artifact_.abi, artifact_.bytecode.object, signer_);
	const contract_ = await factory_.deploy(...args_);
	await contract_.waitForDeployment();
	return contract_;
}

/** Use the last completed V3 cycle on this chain as the real outcome adapter's comparison baseline. */
async function deployV4Companions(gameV3_, owner_) {
	const cycle_ = await gameV3_.roundNum();
	const previous_ = await gameV3_.roundStats(cycle_ - 1n);
	expect(previous_.totalSpentEthAmount, "complete a genuine V3 cycle before deploying the V4 market").to.be.greaterThan(0n);
	const source_ = await deployChaosZeroContract("V3OutcomeSource", owner_, gameV3_.target, cycle_, [
		previous_.numBids, previous_.totalSpentEthAmount, previous_.totalSpentCstAmount, previous_.maxCstBidPrice,
		previous_.enduranceChampionDuration, previous_.chronoWarriorDuration, (previous_.flags & 4n) !== 0n,
	]);
	const cst_ = await hre.ethers.getContractAt("CosmicSignatureToken", await gameV3_.token(), owner_);
	const nft_ = await hre.ethers.getContractAt("CosmicSignatureNft", await gameV3_.nft(), owner_);
	const market_ = await deployChaosZeroContract("GameFundedOutcomeMarket", owner_, cst_.target, source_.target, gameV3_.target);
	const vault_ = new hre.ethers.Contract(await market_.settlementVault(), readChaosZeroArtifact("OutcomeSettlementVault").abi, owner_);
	const auction_ = await (await hre.ethers.getContractFactory("CosmicSignatureArtAuction", owner_)).deploy(gameV3_.target, nft_.target);
	await auction_.waitForDeployment();
	return { auction: auction_, auctionAddress: auction_.target, market: market_, source: source_, cst: cst_, nft: nft_, vault: vault_ };
}

// The fuzz engine mines at a reproducible timestamp and applies gas, CST and NFT events to its shadow ledger.
async function transact(ctx_, label_, actor_, buildTx_, options_ = {}) {
	ctx_.engine.recordTrace({ action: label_, actor: actor_.label, roundNum: ctx_.model.roundNum, plannedTimestamp: options_.ts ?? ctx_.engine.nextTs() });
	const result_ = await ctx_.engine.execTx({ signer: actor_.signer, buildTx: buildTx_, ...options_ });
	return ctx_.engine.expectOk(result_, label_);
}

async function assertFundingAndReplay(ctx_, market_, cycle_, cumulative_, totalBacking_, actor_, replayActor_) {
	const recorded_ = await ctx_.game.contract.chaosZeroFunding(market_.target, cycle_);
	expect(Array.from(recorded_), "game funding record").to.deep.equal([GRANT, cumulative_]);
	const allocations_ = Array.from({ length: QUESTIONS }, (_, index_) =>
		totalBacking_ / 8n + (BigInt(index_) < totalBacking_ % 8n ? 1n : 0n)
	);
	const receipt_ = await transact(ctx_, "synchronize game grant", actor_,
		(overrides_) => market_.connect(actor_.signer).syncFunding(cycle_, overrides_));
	const funding_ = ctx_.engine.singleEvent(receipt_, market_, "GameFundingSynced", "new cycle");
	expect(funding_.args).to.deep.equal([cycle_, GRANT, cumulative_, totalBacking_ - GRANT, allocations_]);
	const replay_ = await transact(ctx_, "replay game grant from another wallet", replayActor_,
		(overrides_) => market_.connect(replayActor_.signer).syncFunding(cycle_, overrides_));
	expect(ctx_.engine.parsedEvents(replay_, market_, "GameFundingSynced"), "one credit per cycle").to.have.length(0);
	expect(await market_.consumedGameFunding()).to.equal(cumulative_);
	expect(await market_.totalActiveCollateral()).to.equal(totalBacking_);
	const questions_ = await market_.questionStates(cycle_);
	expect(questions_).to.have.length(QUESTIONS);
	for (const [index_, question_] of questions_.entries()) {
		expect(question_.activeCollateral, `question ${index_} collateral`).to.equal(allocations_[index_]);
		expect(question_.currentYesBps).to.equal(5_000n);
	}
}

async function exerciseOpeningGrant(ctx_, companions_) {
	const { market, cst, auction } = companions_;
	const cycle_ = await ctx_.game.contract.roundNum();
	expect(await cst.balanceOf(market.target)).to.equal(GRANT);
	expect(await market.consumedGameFunding()).to.equal(0n);
	expect(await auction.registeredBatchCount(), "auction inventory is issued at finalization").to.equal(0n);

	const actors_ = ctx_.actors.filter((actor_) => ctx_.engine.canAfford(actor_.address));
	const traders_ = actors_.filter((actor_) => ctx_.ledger.cstBalanceOf(actor_.address) >= 2n);
	expect(traders_.length, "a previous-cycle participant owns CST to spend in V4").to.be.greaterThan(0);
	const trader_ = ctx_.engine.pick(traders_);
	const holder_ = ctx_.engine.pick(actors_.filter((actor_) => actor_ !== trader_));
	await assertFundingAndReplay(ctx_, market, cycle_, GRANT, GRANT, holder_, trader_);

	const halfBalance_ = ctx_.ledger.cstBalanceOf(trader_.address) / 2n;
	const limit_ = halfBalance_ < 10n * UNIT ? halfBalance_ : 10n * UNIT;
	const split_ = ctx_.engine.randomBigIntRange(1n, limit_);
	const purchase_ = ctx_.engine.randomBigIntRange(1n, limit_);
	const question_ = ctx_.engine.randomIntRange(0, QUESTIONS - 1);
	const yes_ = ctx_.engine.chancePercent(50);

	// A matched pair guarantees one earlier winning position, even if the independently chosen directional trade loses.
	await transact(ctx_, "fund another participant from earned CST", trader_,
		(options_) => cst.connect(trader_.signer).transfer(holder_.address, split_, options_));
	await transact(ctx_, "approve matched position", holder_,
		(options_) => cst.connect(holder_.signer).approve(market.target, split_, options_));
	await transact(ctx_, "split matched position", holder_,
		(options_) => market.connect(holder_.signer).splitPosition(cycle_, question_, split_, options_));
	await transact(ctx_, "approve directional trade", trader_,
		(options_) => cst.connect(trader_.signer).approve(market.target, purchase_, options_));

	// One outcome unit for one CST is a valid conservative buy on either side of a freshly balanced pool.
	await transact(ctx_, "buy seeded outcome", trader_, (options_) => market.connect(trader_.signer).buy(
		cycle_, question_, yes_, purchase_, purchase_, ctx_.engine.lastTs + 60n, options_,
	));
	for (const side_ of [false, true]) {
		const id_ = await market.positionId(cycle_, question_, side_);
		expect(await market.balanceOf(holder_.address, id_)).to.equal(split_);
		expect(await market.balanceOf(trader_.address, id_)).to.equal(side_ === yes_ ? purchase_ : 0n);
	}
	expect(await cst.balanceOf(market.target)).to.equal(GRANT + split_ + purchase_);
	return { cycle: cycle_, question: question_, holder: holder_, trader: trader_, split: split_, purchase: purchase_, yes: yes_, firstBlock: await hre.ethers.provider.getBlockNumber() };
}

function expectedAnswers(current_, previous_) {
	const answers_ = [
		current_.numBids > previous_.numBids,
		current_.enduranceChampionDuration > previous_.enduranceChampionDuration,
		current_.chronoWarriorDuration > previous_.chronoWarriorDuration,
		current_.totalSpentEthAmount > previous_.totalSpentEthAmount,
		current_.totalSpentCstAmount > previous_.totalSpentCstAmount,
		current_.numBids % 2n === 1n,
		(current_.flags & 4n) !== 0n,
		current_.maxCstBidPrice > previous_.maxCstBidPrice,
	];
	return answers_.reduce((mask_, yes_, index_) => yes_ ? mask_ | (1n << BigInt(index_)) : mask_, 0n);
}

async function exerciseRollover(ctx_, companions_, opening_) {
	const { market, source, cst, vault } = companions_;
	const { cycle, question, holder, trader, split, purchase, yes } = opening_;
	const game_ = ctx_.game.contract;
	expect(await game_.roundNum()).to.equal(cycle + 1n);
	const answers_ = expectedAnswers(await game_.roundStats(cycle), await game_.roundStats(cycle - 1n));
	expect(Array.from(await source.outcomeState(cycle))).to.deep.equal([false, true, 255n, answers_]);
	const traderPayout_ = (((answers_ >> BigInt(question)) & 1n) === (yes ? 1n : 0n)) ? purchase : 0n;
	const activeBacking_ = 2n * GRANT + purchase - traderPayout_;
	await assertFundingAndReplay(ctx_, market, cycle + 1n, 2n * GRANT, activeBacking_, trader, holder);
	expect(await cst.balanceOf(market.target)).to.equal(activeBacking_);
	expect(await cst.balanceOf(vault.target)).to.equal(split + traderPayout_);
	expect(await vault.remaining(cycle, question)).to.equal(split + traderPayout_);

	for (const [actor_, payout_] of [[holder, split], [trader, traderPayout_]]) {
		const balance_ = await cst.balanceOf(actor_.address);
		const escrow_ = await cst.balanceOf(vault.target);
		await transact(ctx_, "claim prior-cycle position", actor_,
			(options_) => market.connect(actor_.signer).claimKnown(cycle, options_));
		expect(await cst.balanceOf(actor_.address)).to.equal(balance_ + payout_);
		expect(await cst.balanceOf(vault.target)).to.equal(escrow_ - payout_);
		expect(await vault.remaining(cycle, question)).to.equal(escrow_ - payout_);
	}
	expect(await vault.totalEscrowed()).to.equal(0n);
	expect(await cst.balanceOf(market.target)).to.equal(activeBacking_);
}

async function exerciseAuction(ctx_, companions_, cycle_, firstBlock_) {
	const { auction, nft } = companions_;
	const game_ = ctx_.game.contract;
	expect(await auction.registeredBatchCount()).to.equal(1n);
	const first_ = await auction.firstNftIdByBatchIndex(0n);
	expect(await auction.registeredRounds(cycle_)).to.equal(true);
	expect(await nft.balanceOf(auction.target)).to.equal(8n);
	for (let offset_ = 0n; offset_ < 8n; ++offset_) {
		expect(await nft.ownerOf(first_ + offset_)).to.equal(auction.target);
		expect((await auction.getAuction(first_ + offset_)).roundNum).to.equal(cycle_);
	}
	const id_ = first_ + ctx_.engine.randomBelow(8n);
	const lot_ = await auction.getAuction(id_);
	expect(await auction.minimumNextBid(id_)).to.equal(MINIMUM_BID);
	const closeLogs_ = await auction.queryFilter(auction.filters.AuctionBatchRegistered(cycle_), firstBlock_);
	expect(closeLogs_, "one auction batch per completed cycle").to.have.length(1);
	expect(closeLogs_[0].args.count).to.equal(8n);
	expect(closeLogs_[0].args.firstNftId).to.equal(first_);
	const closeBlock_ = await closeLogs_[0].getBlock();
	expect(lot_.eligibleAt).to.equal(BigInt(closeBlock_.timestamp) + ELIGIBILITY_DELAY);
	const firstBid_ = MINIMUM_BID + ctx_.engine.randomBelow(MINIMUM_BID);
	const nextBid_ = firstBid_ + (firstBid_ + 9n) / 10n;
	const actors_ = ctx_.actors.filter((actor_) => ctx_.engine.canAfford(actor_.address, nextBid_));
	const firstBidder_ = ctx_.engine.pick(actors_);
	const winner_ = ctx_.engine.pick(actors_.filter((actor_) => actor_ !== firstBidder_));
	const bid_ = async (actor_, amount_, ts_) => {
		const receipt_ = await transact(ctx_, "bid on cycle artwork", actor_,
			(options_) => auction.connect(actor_.signer).bid(id_, amount_, { ...options_, value: amount_ }),
			{ ts: ts_, valueNeeded: amount_ });
		ctx_.ledger.addEth(actor_.address, -amount_);
		ctx_.ledger.addEth(auction.target, amount_);
		return BigInt((await receipt_.getBlock()).timestamp);
	};
	const opened_ = await bid_(firstBidder_, firstBid_, lot_.eligibleAt);
	const firstEnd_ = opened_ + AUCTION_DURATION;
	expect((await auction.getAuction(id_)).endAt).to.equal(firstEnd_);
	expect(await auction.minimumNextBid(id_)).to.equal(nextBid_);
	const outbidAt_ = await bid_(winner_, nextBid_, firstEnd_ - ctx_.engine.randomBigIntRange(1n, EXTENSION_DURATION - 1n));
	const end_ = outbidAt_ + EXTENSION_DURATION;
	expect((await auction.getAuction(id_)).endAt).to.equal(end_);
	expect(await auction.refundCredits(firstBidder_.address)).to.equal(firstBid_);
	await expectSolvent(companions_, nextBid_, firstBid_, 0n);
	await transact(ctx_, "retrieve outbid ETH", firstBidder_,
		(options_) => auction.connect(firstBidder_.signer).withdrawRefund(firstBidder_.address, options_));
	ctx_.ledger.addEth(auction.target, -firstBid_);
	ctx_.ledger.addEth(firstBidder_.address, firstBid_);
	expect(await auction.refundCredits(firstBidder_.address)).to.equal(0n);
	await ctx_.ledger.verifyDirtyEth();
	await transact(ctx_, "settle auction", firstBidder_, (options_) => auction.connect(firstBidder_.signer).settle(id_, options_), { ts: end_ });
	await expectSolvent(companions_, 0n, 0n, nextBid_);
	await transact(ctx_, "deliver auction NFT", winner_,
		(options_) => auction.connect(winner_.signer).claimNft(id_, winner_.address, options_));
	expect(await nft.ownerOf(id_)).to.equal(winner_.address);
	const reserve_ = await hre.ethers.provider.getBalance(game_.target);
	const gestures_ = (await game_.roundStats(cycle_ + 1n)).numBids;
	await transact(ctx_, "forward auction proceeds", firstBidder_,
		(options_) => auction.connect(firstBidder_.signer).forwardProceeds(id_, options_));
	ctx_.ledger.addEth(auction.target, -nextBid_);
	ctx_.ledger.addEth(game_.target, nextBid_);
	expect(await hre.ethers.provider.getBalance(game_.target)).to.equal(reserve_ + nextBid_);
	expect((await game_.roundStats(cycle_ + 1n)).numBids).to.equal(gestures_);
	await expectSolvent(companions_, 0n, 0n, 0n);
	await ctx_.ledger.verifyDirtyEth();
}

async function exerciseRolloverAndAuction(ctx_, companions_, opening_) {
	await exerciseRollover(ctx_, companions_, opening_);
	await exerciseAuction(ctx_, companions_, opening_.cycle, opening_.firstBlock);
}

module.exports = { deployV4Companions, exerciseOpeningGrant, exerciseRolloverAndAuction };
