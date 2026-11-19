import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";

import type { Collection, MarketOffer } from "@/lib/marketplace/types";

const wagmiMock = vi.hoisted(() => ({
  account: {
    address: undefined as `0x${string}` | undefined,
    chainId: undefined as number | undefined,
    isConnected: false,
  },
  switchChainAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  routerRefresh: vi.fn(),
  publicClient: undefined as
    | { waitForTransactionReceipt: ReturnType<typeof vi.fn> }
    | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: wagmiMock.routerRefresh }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => wagmiMock.account,
  usePublicClient: () => wagmiMock.publicClient,
  useSwitchChain: () => ({ switchChainAsync: wagmiMock.switchChainAsync }),
  useWriteContract: () => ({
    writeContractAsync: wagmiMock.writeContractAsync,
  }),
}));

vi.mock("@/lib/web3/transaction-preflight", () => ({
  prepareContractWrite: vi.fn(async () => ({ gas: 100_000n })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

import { useBuyListing } from "@/lib/marketplace/use-buy-listing";

const sellerAddress = "0x0000000000000000000000000000000000000001" as const;
const buyerAddress = "0x0000000000000000000000000000000000000002" as const;

const collection = {
  id: "random-walk",
  name: "Random Walk NFTs",
  shortName: "Random Walk",
  description: "",
  artSystem: "",
  nftAddress: "0x895a6F444BE4ba9d124F61DF736605792B35D66b",
  marketplaceAddress: "0x47eF85Dfb775aCE0934fBa9EEd09D22e6eC0Cc08",
  anchoringWalletAddress: "0x5EB3396092841E6c5b0b51141699F6711E830529",
  externalUrl: "https://randomwalknft.com/",
  accent: "copper",
  supplyNoun: {
    singular: "walk",
    plural: "walks",
  },
  tokenRange: { start: 0, end: 2 },
} satisfies Collection;

function listing(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: "sell-7",
    offerId: 40,
    collectionId: "random-walk",
    tokenId: 7,
    kind: "sell",
    priceEth: 1,
    maker: sellerAddress,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function buyThroughHook(offer: MarketOffer) {
  const { result } = renderHook(() =>
    useBuyListing({ collection, offer }),
  );
  let succeeded: boolean | undefined;

  await act(async () => {
    succeeded = await result.current.buy();
  });

  return { result, succeeded };
}

describe("useBuyListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiMock.account = {
      address: buyerAddress,
      chainId: 42161,
      isConnected: true,
    };
    wagmiMock.publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    wagmiMock.writeContractAsync.mockResolvedValue("0xhash");
    wagmiMock.switchChainAsync.mockResolvedValue(undefined);
  });

  it("rejects a listing without a live on-chain offer id", async () => {
    const { result, succeeded } = await buyThroughHook(
      listing({ offerId: undefined }),
    );

    expect(succeeded).toBe(false);
    expect(result.current.blocker?.kind).toBe("missing-offer-id");
    expect(toast.error).toHaveBeenCalledWith("Transaction failed", {
      description: "This listing is missing a live on-chain offer ID.",
    });
    expect(wagmiMock.writeContractAsync).not.toHaveBeenCalled();
  });

  it("rejects buying your own listing even when invoked directly", async () => {
    wagmiMock.account = {
      address: sellerAddress,
      chainId: 42161,
      isConnected: true,
    };

    const { result, succeeded } = await buyThroughHook(listing());

    expect(succeeded).toBe(false);
    expect(result.current.blocker?.kind).toBe("self-listing");
    expect(toast.error).toHaveBeenCalledWith("Transaction failed", {
      description: "You cannot buy your own listing.",
    });
    expect(wagmiMock.writeContractAsync).not.toHaveBeenCalled();
  });

  it("switches to Arbitrum before buying when on another network", async () => {
    wagmiMock.account = {
      address: buyerAddress,
      chainId: 1,
      isConnected: true,
    };

    const { result, succeeded } = await buyThroughHook(listing());

    expect(result.current.blocker?.kind).toBe("wrong-chain");
    expect(wagmiMock.switchChainAsync).toHaveBeenCalledWith({
      chainId: 42161,
    });
    expect(wagmiMock.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "acceptSellOffer",
        args: [40n],
        value: parseEther("1"),
      }),
    );
    expect(succeeded).toBe(true);
    expect(wagmiMock.routerRefresh).toHaveBeenCalled();
  });
});
