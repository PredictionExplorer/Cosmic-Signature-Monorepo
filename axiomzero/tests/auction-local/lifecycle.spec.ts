import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  parseEther,
  numberToHex,
  type Address,
} from "viem";
import { foundry } from "viem/chains";

type Fixture = {
  rpc: string;
  chainId: 31337;
  game: Address;
  nft: Address;
  auction: Address;
  accounts: Address[];
  firstTokenId: number;
  eligibleAt: number;
};
const LOCAL_RPC = "http://127.0.0.1:8559";
const f: Fixture = JSON.parse(
  readFileSync(process.env.AXIOM_AUCTION_FIXTURE!, "utf8"),
);
if (f.rpc !== LOCAL_RPC || f.chainId !== 31337)
  throw Error("Disposable local chain required");
const publicClient = createPublicClient({
  chain: foundry,
  transport: http(LOCAL_RPC),
});
const abi = parseAbi([
  "function minimumNextBid(uint256) view returns(uint256)",
  "function refundCredits(address) view returns(uint256)",
  "function totalPendingProceeds() view returns(uint256)",
  "function totalLiabilities() view returns(uint256)",
  "function ownerOf(uint256) view returns(address)",
]);
async function rpc(method: string, params: unknown[]) {
  const response = await fetch(LOCAL_RPC, {
    redirect: "error",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw Error(body.error.message);
  return body.result;
}
async function moveTo(time: number) {
  if (!Number.isSafeInteger(time) || time < 0)
    throw Error("Invalid local timestamp");
  await rpc("evm_setNextBlockTimestamp", [numberToHex(time)]);
  await rpc("evm_mine", []);
}
function registerNextBatch() {
  execFileSync(
    process.execPath,
    [resolve(__dirname, "seed.mjs"), "--next-batch"],
    {
      cwd: process.env.COSMIC_CONTRACT_ROOT,
      env: { ...process.env, HARDHAT_NETWORK: "hardhat_on_localhost" },
      stdio: "pipe",
    },
  );
  return JSON.parse(
    readFileSync(process.env.AXIOM_AUCTION_FIXTURE! + ".next", "utf8"),
  ) as Pick<Fixture, "firstTokenId" | "eligibleAt">;
}
async function collector(browser: Browser, account: Address) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4599",
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ account, rpc, address }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const provider = {
        isMetaMask: false,
        on(event: string, fn: (...args: unknown[]) => void) {
          const set = listeners.get(event) ?? new Set();
          set.add(fn);
          listeners.set(event, set);
          return provider;
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(fn);
          return provider;
        },
        async request({
          method,
          params = [],
        }: {
          method: string;
          params?: unknown[];
        }) {
          if (method === "eth_requestAccounts") {
            sessionStorage.setItem("rehearsal-connected", account);
            return [account];
          }
          if (method === "eth_accounts")
            return sessionStorage.getItem("rehearsal-connected") === account
              ? [account]
              : [];
          if (method === "wallet_requestPermissions")
            sessionStorage.setItem("rehearsal-connected", account);
          if (
            method === "wallet_getPermissions" ||
            method === "wallet_requestPermissions"
          )
            return sessionStorage.getItem("rehearsal-connected") === account
              ? [{ parentCapability: "eth_accounts" }]
              : [];
          if (method === "eth_chainId") return "0x7a69";
          if (
            method === "wallet_switchEthereumChain" &&
            (params[0] as { chainId: string }).chainId === "0x7a69"
          )
            return null;
          if (method === "net_version") return "31337";
          if (method === "eth_sendTransaction") {
            const tx = params[0] as { from: string; to: string };
            if (
              tx.from.toLowerCase() !== account.toLowerCase() ||
              tx.to.toLowerCase() !== address.toLowerCase()
            )
              throw Error("Unexpected rehearsal transaction destination.");
          } else if (
            ![
              "eth_estimateGas",
              "eth_gasPrice",
              "eth_maxPriorityFeePerGas",
              "eth_getBlockByNumber",
              "eth_feeHistory",
              "eth_getTransactionCount",
              "eth_getBalance",
              "eth_call",
            ].includes(method)
          ) {
            throw Object.assign(
              Error("Unsupported local-wallet method: " + method),
              { code: 4200 },
            );
          }
          const r = await fetch(rpc, {
            redirect: "error",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const result = await r.json();
          if (result.error)
            throw Object.assign(Error(result.error.message), result.error);
          return result.result;
        },
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "db64694b-b193-42ce-8141-a57c41ab347d",
                name: "Rehearsal Wallet",
                rdns: "market.axiomzero.rehearsal",
                icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/>",
              },
              provider,
            },
          }),
        );
      Object.defineProperty(window, "ethereum", {
        value: provider,
        configurable: true,
      });
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account, rpc: LOCAL_RPC, address: f.auction },
  );
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("Browser error:", err.message));
  return page;
}
async function connect(page: Page) {
  await page
    .getByLabel("Auction bidding")
    .getByRole("button", { name: "Connect wallet to bid", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Rehearsal Wallet/i })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /Rehearsal Wallet/i }),
  ).toHaveCount(0);
}
async function bid(page: Page, total: string) {
  await page.getByRole("textbox", { name: "Total bid (ETH)" }).fill(total);
  await page.getByRole("button", { name: "Review bid", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
}
test("two wallets bid, extend, recover ETH and collect a real V4 artwork on Axiom Zero", async ({
  browser,
}) => {
  expect(await publicClient.getChainId()).toBe(31337);
  const [alice, bob, recipient] = f.accounts;
  const token = BigInt(f.firstTokenId);
  const lot = "/auctions/" + f.firstTokenId;
  const a = await collector(browser, alice);
  const b = await collector(browser, bob);
  try {
    await a.goto("/auctions?view=all", { waitUntil: "domcontentloaded" });
    await expect(a.locator('a[href="' + lot + '"]').first()).toBeVisible();
    await a
      .locator('a[href="' + lot + '"]')
      .first()
      .click();
    await expect(a).toHaveURL(new RegExp(lot + "$"));
    await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Review bid", exact: true }),
    ).toHaveCount(0);
    await moveTo(f.eligibleAt);
    await a.reload({ waitUntil: "domcontentloaded" });
    await connect(a);
    await bid(a, "0.001");
    const nextMinimum = () =>
      publicClient.readContract({
        address: f.auction,
        abi,
        functionName: "minimumNextBid",
        args: [token],
      });
    await expect.poll(nextMinimum).toBe(parseEther("0.0011"));
    await expect(
      a.getByRole("textbox", { name: "Total bid (ETH)" }),
    ).toHaveValue("0.0011");
    await bid(a, "0.002");
    await expect.poll(nextMinimum).toBe(parseEther("0.0022"));
    await moveTo(f.eligibleAt + 48 * 3600 - 100);
    await b.goto(lot, { waitUntil: "domcontentloaded" });
    await connect(b);
    await bid(b, "0.003");
    const refund = () =>
      publicClient.readContract({
        address: f.auction,
        abi,
        functionName: "refundCredits",
        args: [alice],
      });
    await expect.poll(refund).toBe(parseEther("0.002"));
    await a.goto("/auctions/account", { waitUntil: "domcontentloaded" });
    await expect(
      a.getByRole("button", { name: "Withdraw refund", exact: true }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "Withdraw refund", exact: true })
      .click();
    await expect.poll(refund).toBe(0n);
    await moveTo(f.eligibleAt + 48 * 3600 + 10);
    await b.reload({ waitUntil: "domcontentloaded" });
    await expect(
      b.getByRole("button", { name: "Review bid", exact: true }),
    ).toBeVisible();
    await moveTo(f.eligibleAt + 48 * 3600 + 610);
    await b.reload({ waitUntil: "domcontentloaded" });
    await b
      .getByRole("button", { name: "Settle auction", exact: true })
      .click();
    await expect
      .poll(() =>
        publicClient.readContract({
          address: f.auction,
          abi,
          functionName: "totalPendingProceeds",
        }),
      )
      .toBe(parseEther("0.003"));
    await b.getByRole("textbox", { name: "Delivery address" }).fill(recipient);
    await b
      .getByRole("button", { name: "Collect artwork", exact: true })
      .click();
    await expect
      .poll(() =>
        publicClient.readContract({
          address: f.nft,
          abi,
          functionName: "ownerOf",
          args: [token],
        }),
      )
      .toBe(recipient);
    const before = await publicClient.getBalance({ address: f.game });
    await b
      .getByRole("button", { name: "Send proceeds to reserve", exact: true })
      .click();
    await expect
      .poll(() => publicClient.getBalance({ address: f.game }))
      .toBe(before + parseEther("0.003"));
    expect(
      await publicClient.readContract({
        address: f.auction,
        abi,
        functionName: "totalLiabilities",
      }),
    ).toBe(0n);
  } finally {
    await Promise.all([a.context().close(), b.context().close()]);
  }
});

test("the registered price is preserved on an unbid lot after a new batch opens at a revised price", async ({
  browser,
}) => {
  const snapshot = await rpc("evm_snapshot", []);
  const page = await collector(browser, f.accounts[0]);
  try {
    const next = registerNextBatch();
    await moveTo(next.eligibleAt);
    for (const [pageNum, tokenId, floor, nextMinimum] of [
      [1, f.firstTokenId + 1, "0.001", "0.0011"],
      [0, next.firstTokenId, "0.002", "0.0022"],
    ] as const) {
      await page.goto("/auctions?view=all&page=" + (pageNum + 1), {
        waitUntil: "domcontentloaded",
      });
      const href = "/auctions/" + tokenId;
      await page
        .locator('a[href="' + href + '"]')
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(href + "$"));
      if (pageNum === 1) await connect(page);
      const input = page.getByRole("textbox", { name: "Total bid (ETH)" });
      await expect(input).toHaveValue(floor);
      if (pageNum === 0) {
        await input.fill("0.001");
        await expect(
          page.getByRole("button", { name: "Review bid", exact: true }),
        ).toBeDisabled();
      }
      await bid(page, floor);
      await expect
        .poll(() =>
          publicClient.readContract({
            address: f.auction,
            abi,
            functionName: "minimumNextBid",
            args: [BigInt(tokenId)],
          }),
        )
        .toBe(parseEther(nextMinimum));
    }
  } finally {
    await page.context().close();
    expect(await rpc("evm_revert", [snapshot])).toBe(true);
  }
});

test("a new mobile collector finds an open auction from a preview and funds a reviewed bid", async ({
  browser,
}, info) => {
  const snapshot = await rpc("evm_snapshot", []);
  const account = f.accounts[2];
  const page = await collector(browser, account);
  try {
    // One eligible batch and one newer preview reproduce the first-time visitor's
    // path even if this case runs alone with a freshly seeded node.
    const block = await publicClient.getBlock();
    if (block.timestamp < BigInt(f.eligibleAt)) await moveTo(f.eligibleAt);
    const preview = registerNextBatch();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/auctions/" + preview.firstTokenId);
    const panel = page.getByLabel("Auction bidding");
    const browse = panel.getByRole("link", { name: "Browse open auctions" });
    await expect(browse).toBeInViewport();
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await browse.press("Enter");
    await expect(page).toHaveURL(/\/auctions\?view=open$/);

    // Discover a bid-ready artwork from its accessible card, without knowing a
    // token ID, a cycle number or the history page on which it was registered.
    await page
      .getByRole("link", { name: /^Place a bid on Cosmic Signature #/i })
      .first()
      .press("Enter");
    await expect(page).toHaveURL(/\/auctions\/\d+$/);
    const lotId = BigInt(new URL(page.url()).pathname.split("/").at(-1)!);
    const walletCta = panel.getByRole("button", {
      name: "Connect wallet to bid",
      exact: true,
    });
    await expect(walletCta).toBeInViewport();
    await connect(page);
    const amount = panel.getByRole("textbox", { name: "Total bid (ETH)" });
    const review = panel.getByRole("button", {
      name: "Review bid",
      exact: true,
    });
    const confirm = panel.getByRole("button", {
      name: "Confirm in wallet",
      exact: true,
    });
    const min = await publicClient.readContract({
      address: f.auction,
      abi,
      functionName: "minimumNextBid",
      args: [lotId],
    });
    const nonce = () =>
      publicClient.getTransactionCount({
        address: account,
        blockTag: "pending",
      });
    const nonceBefore = await nonce();
    const fromBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
    expect(parseEther(await amount.inputValue())).toBe(min);
    await amount.fill("0.0001");
    await expect(review).toBeDisabled();
    await amount.fill("0.004");
    await review.press("Enter");
    await expect(
      panel.getByRole("heading", { name: "Review your bid" }),
    ).toBeFocused();
    await expect(confirm).toBeEnabled();
    expect(await nonce()).toBe(nonceBefore);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    const screenshot = info.outputPath("mobile-bid-review.png");
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await info.attach("mobile-bid-review", {
      path: screenshot,
      contentType: "image/png",
    });
    await panel
      .getByRole("button", { name: "Edit bid", exact: true })
      .press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue("0.004");
    await amount.fill("0.003");
    await review.press("Enter");
    expect(await nonce()).toBe(nonceBefore);
    await confirm.press("Enter");

    const bidEvent = parseAbiItem(
      "event AuctionBidPlaced(uint256 indexed nftId,uint256 indexed roundNum,address indexed bidder,uint256 amount,uint256 ethPaid,uint256 endAt)",
    );
    await expect
      .poll(async () => {
        const logs = await publicClient.getLogs({
          address: f.auction,
          fromBlock,
          event: bidEvent,
          args: { nftId: lotId, bidder: account },
          strict: true,
        });
        return logs.map(({ args }) => [args.amount, args.ethPaid]);
      })
      .toEqual([[parseEther("0.003"), parseEther("0.003")]]);
    await expect(
      panel.getByRole("status").filter({ hasText: "Bid confirmed." }),
    ).toBeVisible();
    expect(await nonce()).toBe(nonceBefore + 1);
  } finally {
    await page.context().close();
    expect(await rpc("evm_revert", [snapshot])).toBe(true);
  }
});
