import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/components/wallet/connect-wallet-button", () => ({
  ConnectWalletButton: () => <button type="button">Connect wallet</button>,
}));

vi.mock("@/lib/web3/transaction-preflight", () => ({
  prepareContractWrite: vi.fn(async () => ({ gas: 100_000n })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

import { BuyNowButton } from "@/components/marketplace/buy-now-button";

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

const listing: MarketOffer = {
  id: "sell-7",
  offerId: 40,
  collectionId: "random-walk",
  tokenId: 7,
  kind: "sell",
  priceEth: 1.15,
  maker: sellerAddress,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderBuyNow(overrides: Partial<MarketOffer> = {}) {
  return render(
    <BuyNowButton
      collection={collection}
      tokenId={7}
      tokenName="Random Walk #000007"
      artwork={{ image: "/token.png", alt: "Token artwork" }}
      offer={{ ...listing, ...overrides }}
      usdPerEth={2000}
    />,
  );
}

function connectWallet(address: `0x${string}`, chainId = 42161) {
  wagmiMock.account = { address, chainId, isConnected: true };
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /buy 1\.15 eth/i }));

  return document.querySelector("dialog") as HTMLDialogElement;
}

describe("BuyNowButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiMock.account = {
      address: undefined,
      chainId: undefined,
      isConnected: false,
    };
    wagmiMock.publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    wagmiMock.writeContractAsync.mockResolvedValue("0xhash");
  });

  it("opens a confirmation with price, USD context, seller, and terms", () => {
    connectWallet(buyerAddress);
    renderBuyNow();

    const dialog = openDialog();

    expect(dialog.open).toBe(true);
    expect(screen.getByText(/confirm purchase/i)).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /random walk #000007/i }),
    ).toBeVisible();
    expect(screen.getByText("≈ $2,300")).toBeVisible();
    expect(screen.getByText("0x0000...0001")).toBeVisible();
    expect(screen.getByText("Arbitrum One")).toBeVisible();
    expect(screen.getByText("0%")).toBeVisible();
  });

  it("completes a purchase and closes the dialog", async () => {
    connectWallet(buyerAddress);
    renderBuyNow();

    const dialog = openDialog();

    fireEvent.click(screen.getByRole("button", { name: /buy for 1\.15 eth/i }));

    await waitFor(() => {
      expect(wagmiMock.writeContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          address: collection.marketplaceAddress,
          functionName: "acceptSellOffer",
          args: [40n],
          value: parseEther("1.15"),
        }),
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Transaction confirmed");
    });
    expect(
      wagmiMock.publicClient?.waitForTransactionReceipt,
    ).toHaveBeenCalledWith({ hash: "0xhash" });
    expect(wagmiMock.routerRefresh).toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog.open).toBe(false);
    });
  });

  it("prompts disconnected visitors to connect a wallet", () => {
    renderBuyNow();
    openDialog();

    expect(
      screen.getByText(/connect a wallet to activate trading controls/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /connect wallet/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /buy for 1\.15 eth/i }),
    ).toBeDisabled();
  });

  it("offers a chain switch when the wallet is on the wrong network", async () => {
    connectWallet(buyerAddress, 1);
    wagmiMock.switchChainAsync.mockResolvedValue(undefined);
    renderBuyNow();
    openDialog();

    expect(
      screen.getByText(/switch to arbitrum to trade through the marketplace/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /buy for 1\.15 eth/i }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /switch to arbitrum/i }),
    );

    await waitFor(() => {
      expect(wagmiMock.switchChainAsync).toHaveBeenCalledWith({
        chainId: 42161,
      });
    });
  });

  it("blocks buying your own listing", () => {
    connectWallet(sellerAddress);
    renderBuyNow();
    openDialog();

    expect(
      screen.getByText(/you cannot buy your own listing/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /buy for 1\.15 eth/i }),
    ).toBeDisabled();
  });

  it("keeps the dialog open and reports failed purchases", async () => {
    connectWallet(buyerAddress);
    wagmiMock.writeContractAsync.mockRejectedValue(
      new Error("User rejected the request"),
    );
    renderBuyNow();

    const dialog = openDialog();

    fireEvent.click(screen.getByRole("button", { name: /buy for 1\.15 eth/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Transaction failed", {
        description: "User rejected the request",
      });
    });
    expect(dialog.open).toBe(true);
    expect(wagmiMock.routerRefresh).not.toHaveBeenCalled();
  });

  it("closes without buying when the visitor cancels", () => {
    connectWallet(buyerAddress);
    renderBuyNow();

    const dialog = openDialog();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(dialog.open).toBe(false);
    expect(wagmiMock.writeContractAsync).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    connectWallet(buyerAddress);
    renderBuyNow();

    const dialog = openDialog();

    // A click landing on the dialog element itself means the backdrop.
    fireEvent.click(dialog);

    expect(dialog.open).toBe(false);
    expect(wagmiMock.writeContractAsync).not.toHaveBeenCalled();
  });
});
