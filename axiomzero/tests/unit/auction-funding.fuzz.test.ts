import fc from "fast-check";
import { formatEther, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";

import {
  bidFunding,
  parseEthInput,
  type AuctionLot,
} from "@/lib/auctions/types";
import { fuzzParams } from "../helpers/fuzz";

const leader = "0x1111111111111111111111111111111111111111";
const challenger = "0x2222222222222222222222222222222222222222";
const lot: AuctionLot = {
  tokenId: 8,
  seed: "0x00",
  roundNum: 1n,
  openingBid: 1n,
  eligibleAt: 0n,
  endAt: 100n,
  highestBidder: leader,
  highestBid: 1n,
  minimumNextBid: 2n,
  settled: false,
  delivered: false,
  proceedsForwarded: false,
};

describe("auction bid amounts", () => {
  it("round-trips exact wei across the contract's uint256 range", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: maxUint256 }), (wei) => {
        expect(parseEthInput(formatEther(wei))).toBe(wei);
      }),
      { ...fuzzParams(500), examples: [[0n], [1n], [maxUint256]] },
    );
    expect(parseEthInput(formatEther(maxUint256 + 1n))).toBeNull();
  });

  it("charges the leader only the increase and a challenger the entire bid", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: maxUint256 / 2n }),
        fc.bigInt({ min: 0n, max: maxUint256 / 4n }),
        (highestBid, extra) => {
          const minimumNextBid = highestBid + (highestBid + 9n) / 10n;
          const total = minimumNextBid + extra;
          const active = { ...lot, highestBid, minimumNextBid };
          expect(bidFunding(active, total, leader) + highestBid).toBe(total);
          expect(bidFunding(active, total, challenger)).toBe(total);
          expect(() => bidFunding(active, minimumNextBid - 1n, leader)).toThrow(
            RangeError,
          );
          expect(() =>
            bidFunding(active, minimumNextBid - 1n, challenger),
          ).toThrow(RangeError);
        },
      ),
      fuzzParams(500),
    );
  });
});
