import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import type { AuctionLot } from "@/lib/auctions/types";

const sources = vi.hoisted(() => ({
  auctionConfigured: true,
  auctionChainId: 42161,
  readBatch: vi.fn(),
  readAuctionSales: vi.fn(),
}));
vi.mock("@/lib/auctions/client", () => sources);
import Results from "@/app/auctions/results/page";
import { AuctionExhibition } from "@/components/marketplace/auction-exhibition";
import { latestAuctionWorks } from "@/lib/marketplace/auction-exhibition";

const lot: AuctionLot = {
  tokenId: 19,
  seed: "0x1234",
  roundNum: 5n,
  openingBid: 1000000000000000n,
  minimumNextBid: 1000000000000000n,
  highestBidder: zeroAddress,
  highestBid: 0n,
  eligibleAt: 0n,
  endAt: 0n,
  settled: false,
  delivered: false,
  proceedsForwarded: false,
};
beforeEach(() => {
  sources.auctionConfigured = true;
  sources.auctionChainId = 42161;
  vi.clearAllMocks();
});

describe("auction discovery on the existing marketplace", () => {
  it("links a real registered work and uses the latest batch", async () => {
    sources.readBatch.mockResolvedValue({ lots: [lot] });
    render(<AuctionExhibition lots={await latestAuctionWorks()} />);
    expect(
      screen.getByRole("heading", { name: "Cycle 5 auctions" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /#19/ })).toHaveAttribute(
      "href",
      "/auctions/19",
    );
    expect(sources.readBatch).toHaveBeenCalledWith(0);
  });
  it("keeps a route to the catalogue when no contract or no RPC is available", async () => {
    sources.auctionConfigured = false;
    expect(await latestAuctionWorks()).toEqual([]);
    expect(sources.readBatch).not.toHaveBeenCalled();
    sources.auctionConfigured = true;
    sources.readBatch.mockRejectedValue(new Error("offline"));
    render(<AuctionExhibition lots={await latestAuctionWorks()} />);
    expect(
      screen.getByRole("link", { name: /Auction catalogue/ }),
    ).toHaveAttribute("href", "/auctions");
  });
});

describe("primary sale results", () => {
  it.each([42161, 31337])(
    "renders exactly one settled sale with its lot and exact price on %d",
    async (chainId) => {
      sources.auctionChainId = chainId;
      const hash = "0xabc";
      sources.readAuctionSales.mockResolvedValue({
        sales: [
          {
            tokenId: 19,
            roundNum: 5n,
            amount: 1000000000000001n,
            winner: zeroAddress,
            hash,
            logIndex: 7,
            timestamp: 1000n,
          },
        ],
        nextBeforeBlock: 12n,
      });
      render(
        await Results({ searchParams: Promise.resolve({ before: "20" }) }),
      );
      expect(sources.readAuctionSales).toHaveBeenCalledWith(20n);
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(screen.getByText("0.001000000000000001 ETH")).toBeVisible();
      expect(
        screen.getByRole("link", { name: /Signature #19/ }),
      ).toHaveAttribute("href", "/auctions/19");
      expect(
        screen.getByRole("link", { name: "Earlier results" }),
      ).toHaveAttribute("href", "/auctions/results?before=12");
      expect(!!screen.queryByRole("link", { name: /1970/ })).toBe(
        chainId === 42161,
      );
    },
  );
  it.each([
    { before: undefined, next: null, message: "No lots have settled yet." },
    {
      before: undefined,
      next: 15n,
      message: "No sales settled in this block range.",
    },
    {
      before: "10",
      next: null,
      message: "No sales settled in this block range.",
    },
  ])(
    "distinguishes an empty page from no results ($before, $next)",
    async ({ before, next, message }) => {
      sources.readAuctionSales.mockResolvedValue({
        sales: [],
        nextBeforeBlock: next,
      });
      render(await Results({ searchParams: Promise.resolve({ before }) }));
      expect(screen.getByText(message)).toBeVisible();
    },
  );
  it("shows an unavailable read separately from prelaunch", async () => {
    sources.auctionConfigured = false;
    const first = render(await Results({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/awaiting activation/)).toBeVisible();
    expect(sources.readAuctionSales).not.toHaveBeenCalled();
    first.unmount();
    sources.auctionConfigured = true;
    sources.readAuctionSales.mockRejectedValue(new Error("offline"));
    render(await Results({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "temporarily unavailable",
    );
  });
  it.each(
    [["unexpected", "query"], "-1", "0x12", "9".repeat(21)].map((before) => ({
      before,
    })),
  )("rejects invalid cursors before reading ($before)", async ({ before }) => {
    await expect(
      Results({ searchParams: Promise.resolve({ before }) }),
    ).rejects.toThrow();
    expect(sources.readAuctionSales).not.toHaveBeenCalled();
  });
});
