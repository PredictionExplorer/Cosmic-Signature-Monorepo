// SPDX-License-Identifier: CC0-1.0
pragma solidity =0.8.38;

import { CosmicSignatureArtAuction } from "../../contracts/production/CosmicSignatureArtAuction.sol";
import { ICosmicSignatureArtAuction } from "../../contracts/production/interfaces/ICosmicSignatureArtAuction.sol";
import { ArtAuctionTestGame, ArtAuctionTestNft } from "../../contracts/tests/ArtAuctionTestHarness.sol";

interface AuctionFuzzVm {
	function deal(address account_, uint256 balance_) external;
	function warp(uint256 timestamp_) external;
	function prank(address sender_) external;
	function expectRevert(bytes calldata revertData_) external;
}

/// @notice Guards the compiler fix for SOL-2026-7; this is a compiler probe, not auction logic.
contract ArtAuctionCompilerRegressionTest {
	uint256[8] private _values;

	function writeThroughReassignedIndex(uint256 initialSteps_, uint256 laterSteps_) external returns (uint256) {
		uint256 index_;
		for (uint256 step_; step_ < initialSteps_; ++step_) ++index_;
		uint256 savedIndex_ = index_ + 1;
		_values[savedIndex_] = 17;
		for (uint256 step_; step_ < laterSteps_; ++step_) ++index_;
		_values[index_] = 29;
		return _values[savedIndex_];
	}

	function test_ReassignedIndexMustInvalidateAliasedStorageKnowledge() public {
		require(this.writeThroughReassignedIndex(0, 1) == 29, "Compiler returned a stale aliased value");
		require(this.writeThroughReassignedIndex(0, 2) == 17, "Compiler confused distinct storage locations");
	}
}

/// @notice Independent EVM fuzz runner; no forge-std dependency or production-source preprocessing.
contract ArtAuctionFuzzTest {
	AuctionFuzzVm private constant _VM = AuctionFuzzVm(address(uint160(uint256(keccak256("hevm cheat code")))));
	ArtAuctionTestGame private _game;
	ArtAuctionTestNft private _nft;
	CosmicSignatureArtAuction private _auction;
	address private constant _ALICE = address(0xA11CE);
	address private constant _BOB = address(0xB0B);

	function setUp() public {
		_game = new ArtAuctionTestGame();
		_nft = new ArtAuctionTestNft(address(_game));
		_game.setNft(address(_nft));
		_auction = new CosmicSignatureArtAuction(address(_game), address(_nft));
		_game.mintAndRegister(address(_auction), 0, 123);
		_VM.warp(_auction.getAuction(0).eligibleAt);
	}

	function testFuzz_RoundingAndExactSelfRaise(uint128 bidInput_) public {
		uint256 firstBid_ = uint256(bidInput_) + _auction.openingBidByRound(0);
		_VM.deal(_ALICE, firstBid_ * 3);
		_VM.prank(_ALICE);
		_auction.bid{value: firstBid_}(0, firstBid_);
		uint256 increase_ = firstBid_ / 10 + (firstBid_ % 10 == 0 ? 0 : 1);
		uint256 nextBid_ = _auction.minimumNextBid(0);
		require(nextBid_ == firstBid_ + increase_, "Incorrect rounded minimum");
		_VM.prank(_ALICE);
		_auction.bid{value: increase_}(0, nextBid_);
		require(_auction.refundCredits(_ALICE) == 0, "Self-raise created refund");
		require(address(_auction).balance == nextBid_, "Incorrect self-raise funding");
		require(_auction.totalLiabilities() == nextBid_, "Incorrect liability");
	}

	function testFuzz_OpeningPriceIsFrozenForEveryLot(uint128 firstInput_, uint128 secondInput_) public {
		uint256 firstPrice_ = uint256(firstInput_) + 1;
		uint256 secondPrice_ = uint256(secondInput_) + 1;
		_game.setArtAuctionOpeningBid(firstPrice_);
		uint256 firstId_ = _game.mintAndRegister(address(_auction), 1, 42);
		_game.setArtAuctionOpeningBid(secondPrice_);
		uint256 secondId_ = _game.mintAndRegister(address(_auction), 2, 43);
		require(_auction.openingBidByRound(1) == firstPrice_, "First batch repriced");
		require(_auction.openingBidByRound(2) == secondPrice_, "Incorrect second batch price");
		for (uint256 index_; index_ < 8; ++index_) {
			require(_auction.minimumNextBid(firstId_ + index_) == firstPrice_, "Old lot's minimum changed");
			require(_auction.minimumNextBid(secondId_ + index_) == secondPrice_, "New lot's minimum incorrect");
		}
		_VM.warp(_auction.getAuction(secondId_).eligibleAt);
		_VM.deal(_ALICE, firstPrice_ + secondPrice_);
		_VM.prank(_ALICE);
		_auction.bid{value: firstPrice_}(firstId_, firstPrice_);
		_VM.prank(_ALICE);
		_auction.bid{value: secondPrice_}(secondId_, secondPrice_);
		require(_auction.totalBidEscrow() == firstPrice_ + secondPrice_, "Incorrect bid escrow");
	}

	function testFuzz_LateBidClock(uint32 arrivalInput_) public {
		uint256 firstBid_ = _auction.openingBidByRound(0);
		_VM.deal(_ALICE, 1 ether);
		_VM.deal(_BOB, 1 ether);
		_VM.prank(_ALICE);
		_auction.bid{value: firstBid_}(0, firstBid_);
		uint256 originalEnd_ = _auction.getAuction(0).endAt;
		uint256 arrival_ = block.timestamp + uint256(arrivalInput_) % _auction.AUCTION_DURATION();
		_VM.warp(arrival_);
		uint256 nextBid_ = _auction.minimumNextBid(0);
		_VM.prank(_BOB);
		_auction.bid{value: nextBid_}(0, nextBid_);
		uint256 expectedEnd_ = originalEnd_ - arrival_ < 600 ? arrival_ + 600 : originalEnd_;
		require(_auction.getAuction(0).endAt == expectedEnd_, "Incorrect close extension");
		require(_auction.refundCredits(_ALICE) == firstBid_, "Lost outbid funds");
	}

	function testFuzz_UnderfundedBidAlwaysRollsBack(uint128 priceInput_, uint128 deficitInput_) public {
		uint256 price_ = uint256(priceInput_) + _auction.openingBidByRound(0);
		uint256 deficit_ = uint256(deficitInput_) % price_ + 1;
		uint256 sent_ = price_ - deficit_;
		_VM.deal(_ALICE, price_);
		_VM.expectRevert(abi.encodeWithSelector(ICosmicSignatureArtAuction.IncorrectBidFunding.selector, price_, sent_));
		_VM.prank(_ALICE);
		_auction.bid{value: sent_}(0, price_);
		require(_auction.getAuction(0).endAt == 0, "Rejected bid started clock");
		require(_auction.totalLiabilities() == 0 && address(_auction).balance == 0, "Rejected bid changed accounting");
	}

	/// @dev Every example accrues a refund in each of two cycles, rejects a payout destination, then pays once.
	function testFuzz_MultipleLotsRefundPreviousLeaderExactlyOnce(
		uint8 tokenInput_, uint8 offsetInput_, uint96 firstInput_, uint96 secondInput_, bool paySelf_
	) public {
		uint256 firstToken_ = uint256(tokenInput_) % 8;
		uint256 opening_ = _game.artAuctionOpeningBid();
		uint256 first_ = opening_ + uint256(firstInput_);
		uint256 second_ = opening_ + uint256(secondInput_);
		uint256 raised_ = 2 * first_;
		_VM.deal(_ALICE, raised_ + second_);
		_VM.deal(_BOB, 2 * (raised_ + second_));

		_VM.prank(_ALICE);
		_auction.bid{value: first_}(firstToken_, first_);
		_VM.prank(_ALICE);
		_auction.bid{value: raised_ - first_}(firstToken_, raised_);
		require(_auction.totalRefundCredits() == 0, "Self raise credited a refund");

		_VM.prank(_BOB);
		_auction.bid{value: 2 * raised_}(firstToken_, 2 * raised_);
		require(_auction.refundCredits(_ALICE) == raised_, "Wrong first credit");

		_game.setArtAuctionOpeningBid(second_);
		uint256 secondToken_ = _game.mintAndRegister(address(_auction), 1, 456) + uint256(offsetInput_) % 8;
		_VM.warp(block.timestamp + 7 days);
		_auction.settle(firstToken_);
		_VM.prank(_ALICE);
		_auction.bid{value: second_}(secondToken_, second_);
		_VM.prank(_BOB);
		_auction.bid{value: 2 * second_}(secondToken_, 2 * second_);
		uint256 credit_ = raised_ + second_;
		require(_auction.refundCredits(_ALICE) == credit_ && _auction.refundCredits(_BOB) == 0, "Wrong credit owner");

		// This test contract has no payable receiver. A failed transfer must leave the credit available for retry.
		_VM.expectRevert(abi.encodeWithSelector(ICosmicSignatureArtAuction.RefundTransferFailed.selector, address(this), credit_));
		_VM.prank(_ALICE);
		_auction.withdrawRefund(payable(address(this)));
		require(_auction.refundCredits(_ALICE) == credit_ && _auction.totalRefundCredits() == credit_, "Failed withdrawal consumed credit");
		address payable recipient_ = payable(paySelf_ ? _ALICE : _BOB);
		uint256 before_ = recipient_.balance;
		_VM.prank(_ALICE);
		_auction.withdrawRefund(recipient_);
		require(recipient_.balance == before_ + credit_, "Recipient paid wrong amount");
		require(_auction.refundCredits(_ALICE) == 0 && _auction.totalRefundCredits() == 0, "Paid credit remains");
		_VM.expectRevert(abi.encodeWithSelector(ICosmicSignatureArtAuction.NoRefundCredit.selector, _ALICE));
		_VM.prank(_ALICE);
		_auction.withdrawRefund(recipient_);
		require(_auction.totalBidEscrow() == 2 * second_, "Withdrawal touched active escrow");
		require(_auction.totalPendingProceeds() == 2 * raised_, "Withdrawal touched settled proceeds");
		require(address(_auction).balance == 2 * credit_, "Wrong balance after withdrawal");
	}
}

/// @notice Tracks the expected lot state and wallet rights from the commands sent to the auction.
contract ArtAuctionInvariantHandler {
	AuctionFuzzVm private constant _VM = AuctionFuzzVm(address(uint160(uint256(keccak256("hevm cheat code")))));
	CosmicSignatureArtAuction public immutable auction;
	ArtAuctionTestGame public immutable game;
	uint256 public totalFunded;
	uint256 public totalRefunded;
	uint256 public totalForwarded;
	uint256 public totalForced;
	uint256 public surplus;
	uint256 private immutable _openingBid;
	ICosmicSignatureArtAuction.Auction[8] private _expectedLots;
	mapping(address => uint256) public expectedCredit;
	mapping(uint256 => address) public deliveredTo;

	constructor(CosmicSignatureArtAuction auction_, ArtAuctionTestGame game_) {
		auction = auction_;
		game = game_;
		_openingBid = game_.artAuctionOpeningBid();
		for (uint256 i_; i_ < 8; ++i_) {
			_expectedLots[i_].registered = true;
			_expectedLots[i_].eligibleAt = block.timestamp + 7 days;
		}
	}

	function expectedLot(uint256 token_) external view returns (ICosmicSignatureArtAuction.Auction memory) {
		return _expectedLots[token_];
	}

	function actor(uint256 index_) public pure returns (address) {
		return address(uint160(0x1000 + index_ % 6));
	}

	function placeBid(uint256 actorInput_, uint256 tokenInput_, uint96 jumpInput_) external {
		uint256 token_ = tokenInput_ % 8;
		ICosmicSignatureArtAuction.Auction storage lot_ = _expectedLots[token_];
		if (block.timestamp < lot_.eligibleAt || (lot_.endAt != 0 && block.timestamp >= lot_.endAt)) return;
		address bidder_ = actor(actorInput_);
		uint256 minimum_ = lot_.highestBid == 0 ? _openingBid : lot_.highestBid + (lot_.highestBid + 9) / 10;
		uint256 amount_ = minimum_ + uint256(jumpInput_) % 3 ether;
		uint256 payment_ = lot_.highestBidder == bidder_ ? amount_ - lot_.highestBid : amount_;
		_VM.deal(bidder_, bidder_.balance + payment_);
		_VM.prank(bidder_);
		auction.bid{value: payment_}(token_, amount_);
		if (lot_.highestBidder != address(0) && lot_.highestBidder != bidder_) expectedCredit[lot_.highestBidder] += lot_.highestBid;
		if (lot_.endAt == 0) lot_.endAt = block.timestamp + 48 hours;
		else if (block.timestamp + 10 minutes > lot_.endAt) lot_.endAt = block.timestamp + 10 minutes;
		lot_.highestBidder = bidder_;
		lot_.highestBid = amount_;
		totalFunded += payment_;
	}

	function advanceTime(uint32 seconds_) external {
		_VM.warp(block.timestamp + uint256(seconds_) % 3 days);
	}

	function settle(uint256 tokenInput_) external {
		uint256 token_ = tokenInput_ % 8;
		ICosmicSignatureArtAuction.Auction storage lot_ = _expectedLots[token_];
		if (lot_.settled || lot_.endAt == 0 || block.timestamp < lot_.endAt) return;
		auction.settle(token_);
		lot_.settled = true;
	}

	function retrieve(uint256 actorInput_, uint256 recipientInput_) external {
		address bidder_ = actor(actorInput_);
		uint256 amount_ = expectedCredit[bidder_];
		if (amount_ == 0) return;
		address payable recipient_ = payable(actor(recipientInput_));
		uint256 before_ = recipient_.balance;
		_VM.prank(bidder_);
		auction.withdrawRefund(recipient_);
		require(recipient_.balance == before_ + amount_, "Refund paid wrong recipient or amount");
		expectedCredit[bidder_] = 0;
		totalRefunded += amount_;
	}

	function receiveNft(uint256 tokenInput_, uint256 recipientInput_) external {
		uint256 token_ = tokenInput_ % 8;
		ICosmicSignatureArtAuction.Auction storage lot_ = _expectedLots[token_];
		if (!lot_.settled || lot_.delivered) return;
		address recipient_ = actor(recipientInput_);
		_VM.prank(lot_.highestBidder);
		auction.claimNft(token_, recipient_);
		lot_.delivered = true;
		deliveredTo[token_] = recipient_;
	}

	function forward(uint256 tokenInput_, bool fail_) external {
		uint256 token_ = tokenInput_ % 8;
		ICosmicSignatureArtAuction.Auction storage lot_ = _expectedLots[token_];
		if (!lot_.settled || lot_.proceedsForwarded) return;
		game.setRejectDonations(fail_);
		if (fail_) {
			try auction.forwardProceeds(token_) { revert("Rejected destination accepted proceeds"); }
			catch { require(!auction.getAuction(token_).proceedsForwarded, "Failed send consumed proceeds"); }
		} else {
			auction.forwardProceeds(token_);
			lot_.proceedsForwarded = true;
			totalForwarded += lot_.highestBid;
		}
		game.setRejectDonations(false);
	}

	function forceEth(uint96 amountInput_) external {
		uint256 amount_ = uint256(amountInput_) % 1 ether;
		_VM.deal(address(auction), address(auction).balance + amount_);
		totalForced += amount_;
		surplus += amount_;
	}

	function forwardSurplus() external {
		uint256 amount_ = surplus;
		if (amount_ == 0) return;
		auction.forwardSurplus();
		surplus = 0;
		totalForwarded += amount_;
	}
}

contract ArtAuctionInvariantTest {
	AuctionFuzzVm private constant _VM = AuctionFuzzVm(address(uint160(uint256(keccak256("hevm cheat code")))));
	ArtAuctionTestGame private _game;
	ArtAuctionTestNft private _nft;
	CosmicSignatureArtAuction private _auction;
	ArtAuctionInvariantHandler private _handler;

	function setUp() public {
		_game = new ArtAuctionTestGame();
		_nft = new ArtAuctionTestNft(address(_game));
		_game.setNft(address(_nft));
		_auction = new CosmicSignatureArtAuction(address(_game), address(_nft));
		_game.mintAndRegister(address(_auction), 0, 321);
		_handler = new ArtAuctionInvariantHandler(_auction, _game);
		_VM.warp(block.timestamp + 7 days);
	}

	struct FuzzSelector { address addr; bytes4[] selectors; }
	struct FuzzArtifactSelector { string artifact; bytes4[] selectors; }
	struct FuzzInterface { address addr; string[] artifacts; }

	// Foundry reads these configuration getters; empty lists retain its default selection policies.
	function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) { return new FuzzArtifactSelector[](0); }
	function targetArtifacts() public pure returns (string[] memory) { return new string[](0); }
	function excludeArtifacts() public pure returns (string[] memory) { return new string[](0); }
	function targetSenders() public pure returns (address[] memory) { return new address[](0); }
	function excludeSenders() public pure returns (address[] memory) { return new address[](0); }
	function excludeContracts() public pure returns (address[] memory) { return new address[](0); }
	function targetInterfaces() public pure returns (FuzzInterface[] memory) { return new FuzzInterface[](0); }
	function targetSelectors() public pure returns (FuzzSelector[] memory) { return new FuzzSelector[](0); }
	function excludeSelectors() public pure returns (FuzzSelector[] memory) { return new FuzzSelector[](0); }

	function targetContracts() public view returns (address[] memory result_) {
		result_ = new address[](1);
		result_[0] = address(_handler);
	}

	function invariant_AllLiabilitiesAndCustodyAreConserved() public view {
		uint256 escrow_;
		uint256 proceeds_;
		uint256 refunds_;
		for (uint256 token_ = 0; token_ < 8; ++token_) {
			ICosmicSignatureArtAuction.Auction memory lot_ = _handler.expectedLot(token_);
			require(keccak256(abi.encode(lot_)) == keccak256(abi.encode(_auction.getAuction(token_))), "Lot differs from command model");
			if (!lot_.settled) escrow_ += lot_.highestBid;
			else if (!lot_.proceedsForwarded) proceeds_ += lot_.highestBid;
			require(_nft.ownerOf(token_) == (lot_.delivered ? _handler.deliveredTo(token_) : address(_auction)), "Custody mismatch");
			if (lot_.delivered || lot_.proceedsForwarded) require(lot_.settled, "Action before settlement");
		}
		for (uint256 index_; index_ < 6; ++index_) {
			address bidder_ = _handler.actor(index_);
			uint256 credit_ = _handler.expectedCredit(bidder_);
			require(_auction.refundCredits(bidder_) == credit_, "Wallet credit differs from command model");
			refunds_ += credit_;
		}
		require(escrow_ == _auction.totalBidEscrow(), "Bid escrow mismatch");
		require(proceeds_ == _auction.totalPendingProceeds(), "Proceeds mismatch");
		require(refunds_ == _auction.totalRefundCredits(), "Refund mismatch");
		require(_auction.totalLiabilities() == escrow_ + proceeds_ + refunds_, "Total liability mismatch");
		require(address(_auction).balance == _auction.totalLiabilities() + _handler.surplus(), "Incorrect surplus or insolvency");
		require(address(_auction).balance == _handler.totalFunded() + _handler.totalForced() - _handler.totalRefunded() - _handler.totalForwarded(), "Cash conservation mismatch");
		require(_game.totalDonations() == _handler.totalForwarded(), "Forwarding mismatch");
		require(_game.receiveCount() == 0, "Raw receive called");
	}

	/// @dev Close every funded lot after each generated sequence and exercise the outstanding rights.
	function afterInvariant() public {
		_VM.warp(block.timestamp + 48 hours);
		for (uint256 token_; token_ < 8; ++token_) {
			_handler.settle(token_);
			_handler.receiveNft(token_, token_);
			_handler.forward(token_, false);
		}
		for (uint256 index_; index_ < 6; ++index_) _handler.retrieve(index_, index_);
		_handler.forwardSurplus();
		invariant_AllLiabilitiesAndCustodyAreConserved();
		require(address(_auction).balance == 0 && _auction.totalLiabilities() == 0, "Outstanding funds cannot exit");
	}
}
