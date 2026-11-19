// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";

/// @dev Reference liabilities come from holders' winning ERC-1155 balances at canonical closure,
/// before any market settlement. They are independent of the vault's accounting and of claim timing.
contract GameFundedClaimBackingTest is Test {
    uint256 private constant GRANT = 8000 ether;
    address private alice;
    address private bob;
    LocalCosmicGame private game;
    LocalCst private cst;
    LocalOutcomeSource private source;
    GameFundedOutcomeMarket private market;
    OutcomeSettlementVault private vault;

    struct Claims {
        uint256[8] alice;
        uint256[8] bob;
    }

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        vm.deal(address(this), 1 ether);
        alice = makeAddr("Alice");
        bob = makeAddr("Bob");
        game = new LocalCosmicGame();
        cst = game.token();
        source = new LocalOutcomeSource(game);
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(cst)), source, address(game));
        vault = market.settlementVault();
        _fundHolder(alice);
        _fundHolder(bob);
        game.setChaosZeroMarket(address(market));
    }

    function _fundHolder(address holder) private {
        vm.startPrank(holder);
        cst.faucet(2000 ether);
        cst.approve(address(market), type(uint256).max);
        vm.stopPrank();
    }

    function _advance() private {
        game.bidEth{value: game.nextEthPrice()}();
        vm.warp(game.mainPrizeTime());
        game.closeCycle();
    }

    function _openPositions(uint256 cycle) private returns (uint256 deposited) {
        for (uint8 q; q < 8; ++q) {
            uint256 alicePairs = (cycle + q + 3) * 1 ether;
            uint256 bobPairs = (uint256(q) + 2) * 1 ether;
            vm.startPrank(alice);
            market.splitPosition(cycle, q, alicePairs);
            market.safeTransferFrom(alice, bob, market.positionId(cycle, q, false), 1 ether, "");
            market.buy(cycle, q, q % 2 == 0, 2 ether, 3 ether, block.timestamp);
            vm.stopPrank();
            vm.prank(bob);
            market.splitPosition(cycle, q, bobPairs);
            deposited += alicePairs + bobPairs + 2 ether;
        }
    }

    function _snapshotClaims(uint256 cycle) private view returns (Claims memory claims, uint256 total) {
        (bool open, bool finalized, uint8 known, uint8 answers) = source.outcomeState(cycle);
        assertFalse(open);
        assertTrue(finalized);
        assertEq(known, type(uint8).max);
        for (uint8 q; q < 8; ++q) {
            uint256 id = market.positionId(cycle, q, (answers & (uint8(1) << q)) != 0);
            claims.alice[q] = market.balanceOf(alice, id);
            claims.bob[q] = market.balanceOf(bob, id);
            assertGt(claims.alice[q], 1 ether);
            assertGt(claims.bob[q], 0);
            total += claims.alice[q] + claims.bob[q];
        }
    }

    function _assertEscrows(Claims memory first, Claims memory third) private view {
        uint256 owed;
        for (uint8 q; q < 8; ++q) {
            uint256 earlier = first.alice[q] + first.bob[q];
            uint256 later = third.alice[q] + third.bob[q];
            assertEq(vault.remaining(1, q), earlier);
            assertEq(vault.remaining(3, q), later);
            owed += earlier + later;
        }
        assertEq(vault.totalEscrowed(), owed);
        assertEq(cst.balanceOf(address(vault)), owed + 1); // One unsolicited base unit stays outside the ledger.
    }

    function _redeem(uint256 cycle, address holder, uint256[8] memory outstanding) private {
        uint256 owed;
        for (uint8 q; q < 8; ++q) {
            owed += outstanding[q];
            outstanding[q] = 0;
        }
        _claimAmount(cycle, holder, owed);
    }

    function _claimAmount(uint256 cycle, address holder, uint256 owed) private {
        (bool ready, uint256 preview,) = market.previewClaim(cycle, holder);
        assertTrue(ready);
        assertEq(preview, owed);
        uint256 before = cst.balanceOf(holder);
        vm.prank(holder);
        assertEq(market.claimKnown(cycle), owed);
        assertEq(cst.balanceOf(holder) - before, owed);
    }

    function testFuzz_transferringSettledPositionsMovesOnlyTheirRemainingClaimRights(
        uint8 rawQuestion,
        uint64 firstTransfer,
        uint64 secondTransfer
    ) public {
        uint8 question = rawQuestion % 8;
        uint256[2] memory alicePairs = [uint256(9 ether), 11 ether];
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = bound(firstTransfer, 1, alicePairs[0] - 1);
        amounts[1] = bound(secondTransfer, 1, alicePairs[1] - 1);

        vm.prank(bob);
        market.splitPosition(1, question, 1 ether);
        for (uint256 i; i < 2; ++i) {
            uint256 cycle = i + 1;
            vm.prank(alice);
            market.splitPosition(cycle, question, alicePairs[i]);
            _advance();
            (,,, uint8 answers) = source.outcomeState(cycle);
            ids[i] = market.positionId(cycle, question, (answers & (uint8(1) << question)) != 0);
        }
        market.syncFunding(3);
        _claimAmount(1, bob, 1 ether);

        vm.prank(alice);
        market.safeBatchTransferFrom(alice, bob, ids, amounts, "");
        assertEq(vault.remaining(1, question), alicePairs[0]);
        assertEq(vault.remaining(2, question), alicePairs[1]);
        assertEq(cst.balanceOf(address(vault)), alicePairs[0] + alicePairs[1]);

        // Bob can redeem newly received units even after redeeming his original cycle-1 position.
        _claimAmount(2, alice, alicePairs[1] - amounts[1]);
        _claimAmount(1, bob, amounts[0]);
        uint256 aliceRemaining = alicePairs[0] - amounts[0];
        assertEq(vault.remaining(1, question), aliceRemaining);
        assertEq(vault.remaining(2, question), amounts[1]);
        assertEq(vault.totalEscrowed(), aliceRemaining + amounts[1]);
        assertEq(cst.balanceOf(address(vault)), aliceRemaining + amounts[1]);
        _claimAmount(1, alice, aliceRemaining);
        _claimAmount(2, bob, amounts[1]);
        _claimAmount(1, bob, 0);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(cst.balanceOf(address(vault)), 0);
        assertEq(market.consumedGameFunding(), 3 * GRANT);
        assertEq(market.totalActiveCollateral(), 3 * GRANT);
        assertEq(cst.balanceOf(address(market)), 3 * GRANT);
    }

    function test_oneGrantPerCycleWhileTwoOlderCyclesRemainRedeemable() public {
        vm.startPrank(bob);
        cst.transfer(address(vault), 1);
        cst.transfer(address(market), 17);
        market.syncFunding(1);
        market.syncFunding(1);
        vm.stopPrank();
        assertEq(market.consumedGameFunding(), GRANT);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, GRANT / 8);
        }
        uint256 active = GRANT + _openPositions(1);
        assertEq(market.totalActiveCollateral(), active);
        _advance();
        (Claims memory first, uint256 firstOwed) = _snapshotClaims(1);
        _advance(); // Cycle 2 was issued a grant but nobody touched its market.
        assertEq(market.consumedGameFunding(), GRANT);

        active = active - firstOwed + 2 * GRANT + _openPositions(3); // First split synchronizes.
        assertEq(market.consumedGameFunding(), 3 * GRANT);
        assertEq(market.totalActiveCollateral(), active);
        Claims memory empty;
        _assertEscrows(first, empty);
        market.syncFunding(3);
        assertEq(market.totalActiveCollateral(), active);
        _advance();
        (Claims memory third, uint256 thirdOwed) = _snapshotClaims(3);

        vm.prank(bob);
        market.buy(4, 7, true, 2 ether, 3 ether, block.timestamp); // First trade synchronizes.
        market.syncFunding(4);
        active = active - thirdOwed + GRANT + 2 ether;
        assertEq(market.consumedGameFunding(), 4 * GRANT);
        assertEq(market.totalActiveCollateral(), active);
        assertEq(cst.balanceOf(address(market)), active + 17);
        _assertEscrows(first, third);

        uint256 aliceBefore = cst.balanceOf(alice);
        vm.prank(alice);
        assertEq(market.mergePosition(1, 0, 1 ether), 1 ether);
        assertEq(cst.balanceOf(alice) - aliceBefore, 1 ether);
        first.alice[0] -= 1 ether;
        _assertEscrows(first, third);
        _redeem(3, bob, third.bob);
        _assertEscrows(first, third);
        _redeem(3, bob, third.bob); // Already paid; no second transfer or debit to another claim.
        _assertEscrows(first, third);
        // Retire the only cycle-4 position before the next rollover. Both older cycles
        // still have claimants; the entire cycle-4 surplus can now be carried.
        vm.prank(bob);
        market.sell(4, 7, true, 3 ether, 1 ether, block.timestamp);
        _advance();
        market.syncFunding(5);
        assertEq(market.consumedGameFunding(), 5 * GRANT);
        uint256 latestPool = active - 1 ether + GRANT;
        assertEq(market.totalActiveCollateral(), latestPool);
        _assertEscrows(first, third);
        _redeem(1, alice, first.alice);
        _assertEscrows(first, third);
        _redeem(3, alice, third.alice);
        _assertEscrows(first, third);
        _redeem(1, bob, first.bob);
        _assertEscrows(first, third);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(market.totalActiveCollateral(), latestPool);
        assertEq(cst.balanceOf(address(market)), latestPool + 17);
    }
}
