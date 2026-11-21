import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import {
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: {
    address: undefined as Address | undefined,
    chainId: 42161,
    connector: { getProvider: vi.fn() },
  },
  network: {
    isPending: false,
    error: null as Error | null,
    switchChain: vi.fn(),
  },
  config: { id: 42161, enabled: true },
  readLot: vi.fn(),
  readBatch: vi.fn(),
  readOpenLots: vi.fn(),
  wallet: vi.fn(),
  history: vi.fn(),
  submit: vi.fn(),
  notFound: vi.fn(() => {
    throw Error("NOT_FOUND");
  }),
}));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useSwitchChain: () => mocks.network,
}));
vi.mock("@/lib/auctions/config", () => ({
  get auctionChainId() {
    return mocks.config.id;
  },
  get auctionConfigured() {
    return mocks.config.enabled;
  },
  auctionAddress: "0x00000000000000000000000000000000000000aa",
}));
vi.mock("@/lib/auctions/client", () => ({
  readLot: mocks.readLot,
  readBatch: mocks.readBatch,
  readOpenLots: mocks.readOpenLots,
  readWalletActivity: mocks.wallet,
  readBidHistory: mocks.history,
}));
vi.mock("@/lib/auctions/actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auctions/actions")>(
    "@/lib/auctions/actions",
  );
  return { ...actual, submitAuctionAction: mocks.submit };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/wallet/connect-wallet-button", () => ({
  ConnectWalletButton: ({
    connectLabel = "Connect wallet",
  }: {
    connectLabel?: string;
  }) => <button>{connectLabel}</button>,
}));
vi.mock("@/components/auctions/collection-31.webp", () => ({
  default: { src: "/collection-31.webp", width: 1280, height: 828 },
}));

import { LiveCatalogue } from "@/components/auctions/live-catalogue";
import { BidForm } from "@/components/auctions/auction-bidding";
import { AuctionLotView, remaining } from "@/components/auctions/auction-lot";
import { AuctionAccount } from "@/components/auctions/auction-account";
import { AuctionHistory } from "@/components/auctions/auction-history";
import {
  AuctionNav,
  CataloguePagination,
  pageNumber,
} from "@/components/auctions/auction-display";
import { LotGrid } from "@/components/auctions/auction-catalogue";
import {
  WalletGate,
  RecipientAction,
  TransactionStatus,
  ChainLink,
  useAuctionTransaction,
} from "@/components/auctions/auction-wallet";
import { AuctionConfirmationPending } from "@/lib/auctions/actions";
import type { AuctionLot } from "@/lib/auctions/types";
import CataloguePage from "@/app/auctions/page";
import CollectorPage from "@/app/auctions/account/page";
import LotPage, { generateMetadata } from "@/app/auctions/[tokenId]/page";
import LoadingAuctions from "@/app/auctions/loading";
import AuctionReadError from "@/app/auctions/error";

const bidder = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const hash = ("0x" + "3".repeat(64)) as Hash;
const seed = ("0x" + "4".repeat(64)) as Hash;
const lot: AuctionLot = {
  tokenId: 20,
  seed,
  roundNum: 4n,
  openingBid: parseEther("0.001"),
  minimumNextBid: parseEther("0.001"),
  eligibleAt: 1700000000n,
  endAt: 0n,
  highestBidder: zeroAddress,
  highestBid: 0n,
  settled: false,
  delivered: false,
  proceedsForwarded: false,
};
const snapshot = (
  more: Partial<AuctionLot> = {},
  blockTime = lot.eligibleAt,
) => ({
  lot: { ...lot, registered: true, ...more },
  blockTime,
  blockNumber: 3n,
});
const receipt = { transactionHash: hash } as TransactionReceipt;
const initial = snapshot();
const media = "https://nfts.cosmicsignature.com";
const walletData = {
  refund: 0n,
  count: 2n,
  leading: [] as AuctionLot[],
  won: [] as AuctionLot[],
  blockTime: initial.blockTime,
  blockNumber: 3n,
};

function renderApp(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 1, gcTime: Infinity },
    },
  });
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.id = 42161;
  mocks.config.enabled = true;
  mocks.account.address = bidder;
  mocks.account.chainId = 42161;
  mocks.network.error = null;
  mocks.readLot.mockResolvedValue(initial);
  mocks.readBatch.mockResolvedValue({
    count: 2n,
    lots: [lot],
    blockTime: initial.blockTime,
    blockNumber: 3n,
  });
  mocks.readOpenLots.mockResolvedValue({
    count: 60n,
    lots: [lot],
    blockTime: initial.blockTime,
    blockNumber: 3n,
    nextBefore: null,
    firstOpening: null,
  });
  mocks.history.mockResolvedValue({ bids: [], nextBeforeBlock: null });
  mocks.wallet.mockResolvedValue(walletData);
  mocks.submit.mockResolvedValue(receipt);
});

it("parses canonical public page numbers and handles clock boundaries", () => {
  expect([undefined, "1", "2"].map(pageNumber)).toEqual([0, 0, 1]);
  for (const bad of ["", "0", "01", "-1", "1.5", "9999999999999999999", ["2"]])
    expect(pageNumber(bad)).toBeNull();
  expect(remaining(0n)).toContain("Awaiting");
  expect(remaining(49n * 3600n + 120n)).toBe("2d 1h 2m");
  expect(remaining(85n)).toBe("0h 01m 25s");
});

it("links the sale, results, collector, and calendar without a connected wallet", async () => {
  const component = await CataloguePage({
    searchParams: Promise.resolve({ page: "1" }),
  });
  const view = renderApp(component);
  expect(screen.getByRole("heading", { name: "Cycle auctions" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Sale results" })).toHaveAttribute(
    "href",
    "/auctions/results",
  );
  const card = screen.getByRole("link", {
    name: /Place a bid on Cosmic Signature #20/,
  });
  expect(card).toHaveAttribute("href", "/auctions/20");
  expect(card).toHaveTextContent("Minimum bid");
  expect(screen.getByRole("link", { name: "All cycles" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const pic = within(card).getByRole("img");
  expect(pic.getAttribute("src")).toContain(seed);
  fireEvent.error(pic);
  expect(pic.getAttribute("src")).toContain("/thumb_black.webp");
  fireEvent.error(pic);
  expect(within(card).getByText("Artwork preview unavailable")).toBeVisible();
  fireEvent.click(screen.getByText("How these auctions work"));
  expect(screen.getByText("48-hour bidding")).toBeVisible();
  expect(screen.getByRole("link", { name: "Older cycle" })).toHaveAttribute(
    "href",
    "/auctions?page=2",
  );
  view.rerender(
    <>
      <AuctionNav results />
      <CataloguePagination base="/auctions" page={1} count={2n} />
    </>,
  );
  expect(screen.getByRole("link", { name: "Sale results" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Newer cycle" })).toHaveAttribute(
    "href",
    "/auctions",
  );
  view.rerender(<CataloguePagination base="/auctions" page={2} count={4n} />);
  expect(screen.getByRole("link", { name: "Newer cycle" })).toHaveAttribute(
    "href",
    "/auctions?page=2",
  );
  view.rerender(<CataloguePagination base="/auctions" page={0} count={1n} />);
  expect(view.container).toBeEmptyDOMElement();
});
it("opens on actionable lots, with stable links to all cycles and an older search", async () => {
  mocks.readOpenLots.mockResolvedValue({
    count: 60n,
    lots: [
      {
        ...lot,
        highestBid: parseEther("0.002"),
        minimumNextBid: parseEther("0.0022"),
        endAt: initial.blockTime + 1234n,
      },
    ],
    blockTime: initial.blockTime,
    blockNumber: 3n,
    nextBefore: 22n,
    firstOpening: null,
  });
  renderApp(await CataloguePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "Open for bids" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "All cycles" })).toHaveAttribute(
    "href",
    "/auctions?view=all",
  );
  const card = screen.getByRole("link", {
    name: "Place a bid on Cosmic Signature #20",
  });
  expect(card).toHaveTextContent("Minimum bid");
  expect(card).toHaveTextContent("0.0022 ETH");
  expect(
    screen.getByRole("link", { name: /Check earlier cycles/ }),
  ).toHaveAttribute("href", "/auctions?view=open&before=22");
  expect(mocks.readBatch).not.toHaveBeenCalled();
});
it("explains when the first bidding opens and makes previews reachable", async () => {
  mocks.readOpenLots.mockResolvedValue({
    count: 1n,
    lots: [],
    blockTime: initial.blockTime,
    blockNumber: 3n,
    nextBefore: null,
    firstOpening: initial.blockTime + 30n,
  });
  renderApp(
    await CataloguePage({ searchParams: Promise.resolve({ view: "open" }) }),
  );
  expect(
    screen.getByRole("heading", { name: "Bidding hasn’t opened yet" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: /Browse all cycles/i }),
  ).toHaveAttribute("href", "/auctions?view=all");
});
it("continues discovery when one bounded group of older cycles has ended", async () => {
  mocks.readOpenLots.mockResolvedValue({
    count: 60n,
    lots: [],
    blockTime: initial.blockTime,
    blockNumber: 3n,
    nextBefore: 4n,
    firstOpening: null,
  });
  renderApp(
    await CataloguePage({
      searchParams: Promise.resolve({ view: "open", before: "8" }),
    }),
  );
  expect(mocks.readOpenLots).toHaveBeenCalledWith(8);
  expect(
    screen.getByRole("link", { name: "Newest eligible cycle" }),
  ).toHaveAttribute("href", "/auctions?view=open");
  expect(
    screen.getByRole("link", { name: /Check earlier cycles/ }),
  ).toHaveAttribute("href", "/auctions?view=open&before=4");
});
it("rejects ambiguous catalogue views and invalid cursors", async () => {
  for (const params of [
    { view: ["open"] },
    { view: "unknown" },
    { view: "open", page: "1" },
    { view: "all", before: "2" },
    { view: "open", before: "0" },
    { before: "9007199254740992" },
    { before: "61" },
  ])
    await expect(
      CataloguePage({ searchParams: Promise.resolve(params) }),
    ).rejects.toThrow("NOT_FOUND");
});

it("describes eligible/active/sold lots and both close time states", () => {
  const active = {
    ...lot,
    highestBid: 12n,
    highestBidder: bidder,
    endAt: lot.eligibleAt + 24n,
  };
  const sold = { ...active, tokenId: 21, settled: true };
  const view = renderApp(
    <LotGrid
      lots={[active, sold]}
      mediaOrigin={media}
      blockTime={lot.eligibleAt}
    />,
  );
  expect(screen.getByText("Live bidding")).toBeVisible();
  expect(screen.getByText("Sale price")).toBeVisible();
  view.rerender(
    <LotGrid lots={[active]} mediaOrigin={media} blockTime={active.endAt} />,
  );
  expect(screen.getByText("Bidding ended")).toBeVisible();
  view.rerender(
    <LotGrid lots={[]} mediaOrigin={media} blockTime={active.endAt} />,
  );
  expect(view.container).toBeEmptyDOMElement();
});
it("serves honest prelaunch states and treats malformed or absent IDs as not found", async () => {
  mocks.config.enabled = false;
  renderApp(await CataloguePage({ searchParams: Promise.resolve({}) }));
  expect(
    screen.getByRole("link", { name: /Collection artwork/ }),
  ).toHaveAttribute("href", "/token/cosmic-signature/31");
  expect(mocks.readBatch).not.toHaveBeenCalled();
  renderApp(await CollectorPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText(/Wallet activity will be available/)).toBeVisible();
  for (const tokenId of ["20", "-1", "0001", "1.9", "999999999999999999"])
    await expect(
      LotPage({ params: Promise.resolve({ tokenId }) }),
    ).rejects.toThrow("NOT_FOUND");
  for (const p of [CataloguePage, CollectorPage])
    await expect(
      p({ searchParams: Promise.resolve({ page: "0" }) }),
    ).rejects.toThrow("NOT_FOUND");
  await expect(
    CataloguePage({ searchParams: Promise.resolve({ page: "2" }) }),
  ).rejects.toThrow("NOT_FOUND");
  mocks.config.enabled = true;
  await expect(
    CataloguePage({ searchParams: Promise.resolve({ page: "45" }) }),
  ).rejects.toThrow("NOT_FOUND");
  mocks.readLot.mockResolvedValue(null);
  await expect(
    LotPage({ params: Promise.resolve({ tokenId: "20" }) }),
  ).rejects.toThrow("NOT_FOUND");
  expect(
    (await generateMetadata({ params: Promise.resolve({ tokenId: "20" }) }))
      .title,
  ).toContain("#20");
});

it("renders initial lot, account and read-failure pages independently of wallet connection", async () => {
  mocks.account.address = undefined;
  const view = renderApp(
    await LotPage({ params: Promise.resolve({ tokenId: "20" }) }),
  );
  expect(screen.getByRole("heading", { name: "Signature #20" })).toBeVisible();
  expect(screen.getByText("On-chain artwork seed")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Connect wallet to bid" }),
  ).toBeVisible();
  view.rerender(await CollectorPage({ searchParams: Promise.resolve({}) }));
  expect(
    screen.getByRole("heading", { name: "Connect your wallet" }),
  ).toBeVisible();
  view.rerender(<LoadingAuctions />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading auction data");
  const reset = vi.fn();
  view.rerender(<AuctionReadError reset={reset} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reset).toHaveBeenCalled();
});

it("quotes binding bid and amount due, then sends exactly the reviewed command", async () => {
  const send = vi.fn().mockResolvedValue(true);
  const live = {
    ...lot,
    highestBidder: bidder,
    highestBid: parseEther("100"),
    minimumNextBid: parseEther("110"),
  };
  renderApp(<BidForm lot={live} busy={false} onAction={send} />);
  const field = screen.getByRole("textbox", { name: "Total bid (ETH)" });
  fireEvent.change(field, { target: { value: "0.0000000000000000001" } });
  expect(screen.getByRole("button", { name: "Review bid" })).toBeDisabled();
  fireEvent.submit(field.closest("form")!);
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "110" } });
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  expect(screen.getByText("Due from wallet").parentElement).toHaveTextContent(
    "10 ETH",
  );
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Review your bid" }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Edit bid" }));
  expect(
    screen.getByRole("textbox", { name: "Total bid (ETH)" }),
  ).toHaveFocus();
  expect(screen.getByRole("textbox")).toHaveValue("110");
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      kind: "bid",
      tokenId: 20,
      total: parseEther("110"),
      expectedFunding: parseEther("10"),
    }),
  );
});
it("invalidates a review after an outbid or account change", async () => {
  const send = vi.fn().mockResolvedValue(false);
  const view = renderApp(<BidForm lot={lot} busy={false} onAction={send} />);
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  mocks.account.address = other;
  view.rerender(<BidForm lot={lot} busy={false} onAction={send} />);
  expect(screen.getByRole("status")).toHaveTextContent(/wallet changed/);
  mocks.account.address = bidder;
  view.rerender(<BidForm lot={lot} busy={false} onAction={send} />);
  expect(
    screen.queryByRole("button", { name: "Confirm in wallet" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  view.rerender(<BidForm lot={lot} busy onAction={send} />);
  expect(screen.getByRole("button", { name: "Review bid" })).toBeDisabled();
});
it("requires another review when the minimum rises below a manually entered bid", () => {
  const send = vi.fn();
  const view = renderApp(<BidForm lot={lot} busy={false} onAction={send} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  view.rerender(
    <BidForm
      lot={{ ...lot, minimumNextBid: lot.minimumNextBid + 1n }}
      busy={false}
      onAction={send}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Confirm in wallet" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Review bid" })).toBeEnabled();
  expect(send).not.toHaveBeenCalled();
});
it("requires a fresh review when the open lot changes at the same price", () => {
  const send = vi.fn().mockResolvedValue(true);
  const view = renderApp(<BidForm lot={lot} busy={false} onAction={send} />);
  fireEvent.click(screen.getByRole("button", { name: "Review bid" }));
  expect(
    screen.getByRole("button", { name: "Confirm in wallet" }),
  ).toBeVisible();
  view.rerender(
    <BidForm
      lot={{ ...lot, tokenId: lot.tokenId + 1 }}
      busy={false}
      onAction={send}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Confirm in wallet" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Review bid" })).toBeEnabled();
  view.rerender(<BidForm lot={lot} busy={false} onAction={send} />);
  expect(
    screen.queryByRole("button", { name: "Confirm in wallet" }),
  ).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it("shows network recovery with both supported network labels", () => {
  mocks.account.chainId = 1;
  const view = renderApp(<WalletGate>Bid</WalletGate>);
  fireEvent.click(
    screen.getByRole("button", { name: "Switch to Arbitrum One" }),
  );
  expect(mocks.network.switchChain).toHaveBeenCalledWith({ chainId: 42161 });
  mocks.config.id = 31337;
  mocks.network.error = new Error("switch");
  view.rerender(<WalletGate>Bid</WalletGate>);
  expect(
    screen.getByRole("button", { name: /local auction chain/ }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toBeVisible();
});
it("supports recipient selection, rejects reserved addresses and disables duplicate submissions", async () => {
  const send = vi.fn().mockResolvedValue(true);
  const view = renderApp(
    <RecipientAction
      kind="claimNft"
      owner={bidder}
      tokenId={20}
      disabled={false}
      onAction={send}
    />,
  );
  const addr = screen.getByRole("textbox", { name: "Delivery address" });
  for (const bad of [
    "garbage",
    zeroAddress,
    "0x00000000000000000000000000000000000000aa",
  ]) {
    fireEvent.change(addr, { target: { value: bad } });
    expect(
      screen.getByRole("button", { name: "Collect artwork" }),
    ).toBeDisabled();
    fireEvent.submit(addr.closest("form")!);
    expect(send).not.toHaveBeenCalled();
  }
  fireEvent.change(addr, { target: { value: other } });
  fireEvent.click(screen.getByRole("button", { name: "Collect artwork" }));
  expect(send).toHaveBeenCalledWith({
    kind: "claimNft",
    tokenId: 20,
    recipient: other,
  });
  view.rerender(
    <RecipientAction
      kind="withdrawRefund"
      owner={bidder}
      disabled={false}
      onAction={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Withdraw refund" }));
  expect(send).toHaveBeenCalledWith({
    kind: "withdrawRefund",
    recipient: other,
  });
  view.rerender(
    <RecipientAction
      kind="withdrawRefund"
      owner={bidder}
      disabled
      onAction={send}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Withdraw refund" }),
  ).toBeDisabled();
});

function TxHarness() {
  const tx = useAuctionTransaction();
  return (
    <>
      <button onClick={() => void tx.run({ kind: "settle", tokenId: 20 })}>
        Start
      </button>
      <output>{String(tx.busy)}</output>
      <TransactionStatus state={tx.state} />
    </>
  );
}
it("tracks signature, receipt and confirmed transaction independently", async () => {
  let complete!: (receipt: TransactionReceipt) => void;
  mocks.submit.mockImplementation((_provider, _account, _action, onHash) => {
    onHash(hash);
    return new Promise((res) => {
      complete = res;
    });
  });
  renderApp(<TxHarness />);
  fireEvent.click(screen.getByText("Start"));
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText(/waiting for confirmation/i);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("link", { name: /Transaction 0x333333/ }),
  ).toHaveAttribute("href", `https://arbiscan.io/tx/${hash}`);
  await act(async () => complete(receipt));
  await screen.findByText(/Transaction confirmed/);
});
it.each([
  [{ code: 4001 }, "declined"],
  [{ name: "UserRejectedRequestError" }, "declined"],
  [{ shortMessage: "Balance too low" }, "Balance too low"],
  [new Error("Minimum changed"), "Minimum changed"],
  [new TypeError("rpc"), "could not be completed"],
])(
  "reports transaction failure without signaling completion",
  async (error, word) => {
    mocks.submit.mockRejectedValue(error);
    renderApp(<TxHarness />);
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(String(word)),
    );
  },
);
it("retains unresolved submissions, and gives local-chain hashes without public explorer URLs", async () => {
  mocks.config.id = 31337;
  mocks.submit.mockRejectedValue(
    new AuctionConfirmationPending(hash, new Error()),
  );
  const view = renderApp(<TxHarness />);
  fireEvent.click(screen.getByText("Start"));
  await screen.findByText(/Confirmation is unavailable/);
  expect(screen.getByTitle(hash)).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
  view.rerender(<ChainLink hash={hash}>transaction</ChainLink>);
  expect(screen.getByText("transaction")).toBeVisible();
});
it("browses the latest wallet page and older cycles, including post-settlement activity", async () => {
  const settled = {
    ...lot,
    tokenId: 22,
    highestBid: 10n,
    endAt: lot.eligibleAt,
    settled: true,
  };
  mocks.wallet.mockResolvedValue({
    ...walletData,
    refund: parseEther("1"),
    leading: [{ ...lot, endAt: lot.eligibleAt + 10n }],
    won: [
      { ...settled, settled: false, tokenId: 21 },
      settled,
      { ...settled, delivered: true, tokenId: 23 },
    ],
  });
  renderApp(<AuctionAccount page={1} />);
  await screen.findByText("Available refund");
  expect(screen.getByRole("link", { name: /Signature #21/ })).toHaveTextContent(
    "Awaiting settlement",
  );
  expect(screen.getByRole("link", { name: /Signature #22/ })).toHaveTextContent(
    "Ready to collect",
  );
  expect(screen.getByRole("link", { name: /Signature #23/ })).toHaveTextContent(
    "Delivered",
  );
  expect(screen.getByRole("button", { name: "Withdraw refund" })).toBeEnabled();
});
it("distinguishes empty, out-of-range, and unavailable wallet activity", async () => {
  mocks.wallet.mockRejectedValue(new Error("rpc"));
  const view = renderApp(<AuctionAccount page={0} />);
  expect(screen.getByRole("status")).toHaveTextContent(/Reading your/);
  await screen.findByText(/Wallet activity could not be read/);
  mocks.wallet.mockResolvedValue(walletData);
  fireEvent.click(screen.getByText("Try again"));
  await screen.findByText(/no leading bids/);
  expect(screen.getByText(/no won artworks/)).toBeVisible();
  view.rerender(<AuctionAccount page={4} />);
  await screen.findByText(/No cycle on this page/);
});
it("reads bid history newest-first and follows an empty block range", async () => {
  mocks.history
    .mockResolvedValueOnce({ bids: [], nextBeforeBlock: 30n })
    .mockResolvedValue({
      bids: [
        {
          amount: 40n,
          hash,
          bidder,
          endAt: 10n,
          blockNumber: 20n,
          logIndex: 1,
        },
      ],
      nextBeforeBlock: null,
    });
  renderApp(<AuctionHistory tokenId={20} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    /Reading confirmed bids/,
  );
  const more = await screen.findByRole("button", { name: "Load older blocks" });
  fireEvent.click(more);
  await screen.findByRole("link", { name: "Block 20" });
  expect(mocks.history).toHaveBeenCalledWith(20, 30n);
});
it("offers retry when bid history is unavailable", async () => {
  mocks.history.mockRejectedValue(new Error("rpc"));
  renderApp(<AuctionHistory tokenId={20} />);
  await screen.findByRole("alert");
  mocks.history.mockResolvedValue({ bids: [], nextBeforeBlock: null });
  fireEvent.click(screen.getByText("Try again"));
  await screen.findByText(/No bids recorded/);
});
it.each([
  "preview",
  "active",
  "ended",
  "settled",
  "delivered",
  "collected by other",
  "stale",
])("handles %s lot without assuming an unconfirmed sale", async (phase) => {
  const high = phase !== "preview",
    settled = ["settled", "delivered", "collected by other"].includes(phase);
  const s = snapshot({
    highestBid: high ? 100n : 0n,
    highestBidder: phase === "collected by other" ? other : bidder,
    settled,
    delivered: phase === "delivered",
    proceedsForwarded: phase === "delivered",
    eligibleAt:
      phase === "preview" ? initial.blockTime + 100n : initial.blockTime,
    endAt:
      phase === "active"
        ? initial.blockTime + 100n
        : phase === "preview"
          ? 0n
          : initial.blockTime,
  });
  mocks.readLot.mockResolvedValue(phase === "stale" ? null : s);
  renderApp(<AuctionLotView initial={s} mediaOrigin={media} />);
  if (phase === "preview") {
    expect(screen.getByText("Bidding opens in")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse open auctions" }),
    ).toHaveAttribute("href", "/auctions?view=open");
    expect(screen.queryByRole("button", { name: "Review bid" })).toBeNull();
  }
  if (phase === "active") {
    expect(screen.getByText("Minimum next bid")).toBeVisible();
    expect(screen.getByText("Time remaining")).toBeVisible();
  }
  if (phase === "ended") {
    fireEvent.click(screen.getByRole("button", { name: "Settle auction" }));
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith(
        undefined,
        bidder,
        { kind: "settle", tokenId: 20 },
        expect.any(Function),
      ),
    );
  }
  if (phase === "settled") {
    fireEvent.click(
      screen.getByRole("button", { name: "Send proceeds to reserve" }),
    );
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith(
        undefined,
        bidder,
        { kind: "forwardProceeds", tokenId: 20 },
        expect.any(Function),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Collect artwork" }),
    ).toBeVisible();
  }
  if (phase === "delivered") {
    expect(screen.getByText("Delivered")).toBeVisible();
    expect(screen.getByText("Proceeds received")).toBeVisible();
  }
  if (phase === "collected by other")
    expect(screen.getByText(/Only the winning wallet/)).toBeVisible();
  if (phase === "stale") {
    await screen.findByText(/Transactions are paused/);
    mocks.readLot.mockResolvedValue(s);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() =>
      expect(screen.queryByText(/Transactions are paused/)).toBeNull(),
    );
  }
});

it("ticks the remaining time on an active lot and falls back to its full-size legacy renderer", async () => {
  const s = snapshot({
    highestBid: 100n,
    highestBidder: bidder,
    minimumNextBid: 110n,
    endAt: initial.blockTime + 10n,
  });
  mocks.readLot.mockResolvedValue(s);
  renderApp(<AuctionLotView initial={s} mediaOrigin={media} />);
  expect(screen.getByText("0h 00m 10s")).toBeVisible();
  const pic = screen.getByRole("img");
  fireEvent.error(pic);
  expect(pic.getAttribute("src")).toContain(seed + ".png");
  await waitFor(() => expect(screen.queryByText("0h 00m 10s")).toBeNull(), {
    timeout: 3500,
  });
});
it("pauses wallet withdrawals on an intermittent read error and re-enables after refresh", async () => {
  mocks.wallet.mockResolvedValue({ ...walletData, refund: 10n });
  const { client } = renderApp(<AuctionAccount page={0} />);
  await screen.findByRole("button", { name: "Withdraw refund" });
  mocks.wallet.mockRejectedValue(new Error("rpc"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["auction", "wallet"] });
  });
  await screen.findByText(/Wallet data could not be refreshed/);
  expect(
    screen.getByRole("button", { name: "Withdraw refund" }),
  ).toBeDisabled();
  mocks.wallet.mockResolvedValue({ ...walletData, refund: 10n });
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Withdraw refund" }),
    ).toBeEnabled(),
  );
});

it("keeps the last verified catalogue visible while retrying a failed live update", async () => {
  const batch = {
    count: 1n,
    lots: [{ ...lot, registered: true }],
    blockTime: initial.blockTime,
    blockNumber: 4n,
  };
  mocks.readBatch.mockRejectedValue(new Error("temporarily offline"));
  renderApp(
    <LiveCatalogue initial={batch} view="all" page={0} mediaOrigin={media} />,
  );
  await screen.findByRole("alert");
  expect(screen.getByText("Signature #20")).toBeVisible();
  mocks.readBatch.mockResolvedValue({ ...batch, count: 0n, lots: [] });
  fireEvent.click(screen.getByText("Refresh catalogue"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText(/first sale opens/)).toBeVisible();
});
