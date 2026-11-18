import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  verified: vi.fn(),
  finalized: vi.fn(),
  page: vi.fn(),
  secondary: vi.fn(),
  cache: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>, keys: string[]) => {
    harness.cache(keys);
    return read;
  },
}));
vi.mock("@/lib/auctions/config", () => ({
  auctionConfigured: true,
  auctionChainId: 42161,
  requireAuctionConfig: () => ({
    address: "0x1111111111111111111111111111111111111111",
    hash: "0xabc",
    deploymentBlock: 300n,
  }),
}));
vi.mock("@/lib/auctions/client", () => ({
  verifiedSnapshot: harness.verified,
  readSettlementsPage: harness.page,
}));
vi.mock("@/lib/marketplace/cosmic-signature-market-live", () => ({
  fetchCosmicSignatureSales: harness.secondary,
}));

describe("configured auction settlement feed", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    harness.verified.mockResolvedValue({
      blockNumber: 400n,
      client: { getBlock: harness.finalized },
    });
    harness.finalized.mockResolvedValue({ number: 370n });
    harness.secondary.mockResolvedValue([]);
  });
  it("translates only verified finalized settlements, coalesces readers and reuses a complete snapshot", async () => {
    const { getCollectionSales } = await import("@/lib/marketplace/sales-live");
    harness.page.mockResolvedValue({
      nextBeforeBlock: null,
      sales: [
        {
          tokenId: 7,
          roundNum: 4n,
          winner: "0x2222222222222222222222222222222222222222",
          amount: 1500000000000000n,
          blockNumber: 330n,
          hash: "0xaabb",
          logIndex: 4,
          timestamp: 1000n,
        },
      ],
    });
    const [a, b] = await Promise.all([
      getCollectionSales("cosmic-signature"),
      getCollectionSales("cosmic-signature"),
    ]);
    expect(a).toEqual(b);
    expect(a?.[0]).toMatchObject({
      source: "auction",
      priceEth: 0.0015,
      tokenId: 7,
      roundNum: "4",
      blockNumber: 330,
      settlementId: "42161:0x1111111111111111111111111111111111111111:0xaabb:4",
      soldAt: "1970-01-01T00:16:40.000Z",
    });
    expect(harness.finalized).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(harness.page).toHaveBeenCalledWith(expect.anything(), 300n, 370n);
    expect(await getCollectionSales("cosmic-signature")).toEqual(a);
    expect(harness.page).toHaveBeenCalledTimes(1);
    expect(harness.cache).toHaveBeenCalledTimes(1);
  });
  it("withholds totals when authenticated index history is unavailable, then recovers", async () => {
    const { getCollectionSales } = await import("@/lib/marketplace/sales-live");
    harness.page.mockRejectedValueOnce(Error("offline"));
    expect(await getCollectionSales("cosmic-signature")).toBeUndefined();
    harness.page.mockResolvedValueOnce({ sales: [], nextBeforeBlock: null });
    expect(await getCollectionSales("cosmic-signature")).toEqual([]);
  });
});
