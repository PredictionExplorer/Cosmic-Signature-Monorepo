import { parseAbi } from "viem";

// Mirrors the v4 auction interface. The bid floor is frozen when the game registers a batch.
export const auctionAbi = parseAbi([
  "struct Auction { uint256 roundNum; uint256 eligibleAt; uint256 endAt; address highestBidder; uint256 highestBid; bool registered; bool settled; bool delivered; bool proceedsForwarded; }",
  "function game() view returns (address)",
  "function nft() view returns (address)",
  "function registeredBatchCount() view returns (uint256)",
  "function firstNftIdByBatchIndex(uint256) view returns (uint256)",
  "function getAuction(uint256) view returns (Auction)",
  "function openingBidByRound(uint256) view returns (uint256)",
  "function minimumNextBid(uint256) view returns (uint256)",
  "function refundCredits(address) view returns (uint256)",
  "function bid(uint256 nftId,uint256 totalBidAmount) payable",
  "function settle(uint256 nftId)",
  "function claimNft(uint256 nftId,address recipient)",
  "function withdrawRefund(address recipient)",
  "function forwardProceeds(uint256 nftId)",
  "event AuctionBidPlaced(uint256 indexed nftId,uint256 indexed roundNum,address indexed bidder,uint256 amount,uint256 ethPaid,uint256 endAt)",
  "event AuctionSettled(uint256 indexed nftId,uint256 indexed roundNum,address indexed winner,uint256 amount)",
  "error UnknownAuction(uint256 nftId)",
  "error BidTooLow(uint256 minimumBid,uint256 proposedBid)",
  "error AuctionEnded(uint256 nftId,uint256 endAt)",
  "error AuctionNotEligible(uint256 nftId,uint256 eligibleAt)",
  "error IncorrectBidFunding(uint256 requiredValue,uint256 suppliedValue)",
]);
