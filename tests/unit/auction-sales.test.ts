import { describe, expect, it, vi } from "vitest";
import { SettlementIndex } from "@/lib/marketplace/auction-sales";
import {
  mergeCollectionSales,
  summarizeSales,
} from "@/lib/marketplace/sales-live";
import type { MarketSale } from "@/lib/marketplace/types";

const primary: Extract<MarketSale, { source: "auction" }> = {
  source: "auction",
  collectionId: "cosmic-signature",
  tokenId: 7,
  seller: "0x1111111111111111111111111111111111111111",
  buyer: "0x2222222222222222222222222222222222222222",
  settlementId: "auction:tx:1",
  transactionHash: "0xaaaa",
  logIndex: 1,
  roundNum: "4",
  blockNumber: 91,
  priceEth: 1,
};

describe("finalized auction sale accounting", () => {
  it("backfills bounded work, resumes its exact cursor, and counts each verified settlement once", async () => {
    const index = new SettlementIndex(10n);
    const read = vi.fn(async (from: bigint, end: bigint) => ({
      rows: [primary],
      next: end - from > 20n ? String(end - 20n) : null,
    }));
    expect(await index.catchUp(99n, read)).toBeUndefined();
    expect(read.mock.calls).toEqual([
      [10n, 99n],
      [10n, 79n],
      [10n, 59n],
    ]);
    expect(await index.catchUp(101n, read)).toEqual([primary]);
    expect(read.mock.calls.slice(3)).toEqual([
      [10n, 39n],
      [10n, 19n],
      [100n, 101n],
    ]);
    expect(await index.catchUp(101n, read)).toEqual([primary]);
    expect(read).toHaveBeenCalledTimes(6);
    await expect(index.catchUp(100n, read)).rejects.toThrow("backwards");
  });
  it("retries a failed interval and rejects non-advancing cursors", async () => {
    const index = new SettlementIndex(0n);
    await expect(
      index.catchUp(50n, async () => {
        throw Error("offline");
      }),
    ).rejects.toThrow("offline");
    await expect(
      index.catchUp(50n, async () => ({ rows: [], next: "50" })),
    ).rejects.toThrow("cursor");
    expect(
      await index.catchUp(50n, async () => ({ rows: [primary], next: null })),
    ).toEqual([primary]);
  });
  it("keeps genuine secondary resales of the same NFT, separates offer IDs, and excludes duplicate logs", () => {
    const secondary: MarketSale = {
      collectionId: primary.collectionId,
      tokenId: 7,
      offerId: 7,
      priceEth: 2,
      seller: primary.buyer,
      buyer: primary.seller,
      blockNumber: 100,
    };
    const sales = mergeCollectionSales(
      [secondary, secondary],
      [primary, primary],
    );
    expect(sales).toEqual([secondary, primary]);
    expect(summarizeSales(sales)).toEqual({
      count: 2,
      volumeEth: 3,
      topSale: secondary,
      lastSale: secondary,
      primarySale: primary,
    });
  });
});
