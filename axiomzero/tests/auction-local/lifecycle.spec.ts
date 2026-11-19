import { test, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  parseAbi,
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
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
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
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await page.getByRole("button", { name: "Confirm bid", exact: true }).click();
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
    await a.goto("/auctions", { waitUntil: "domcontentloaded" });
    await expect(a.locator('a[href="' + lot + '"]').first()).toBeVisible();
    await a
      .locator('a[href="' + lot + '"]')
      .first()
      .click();
    await expect(a).toHaveURL(new RegExp(lot + "$"));
    await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Place bid", exact: true }),
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
      b.getByRole("button", { name: "Place bid", exact: true }),
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
    execFileSync(
      process.execPath,
      [resolve(__dirname, "seed.mjs"), "--next-batch"],
      {
        cwd: process.env.COSMIC_CONTRACT_ROOT,
        env: { ...process.env, HARDHAT_NETWORK: "hardhat_on_localhost" },
        stdio: "pipe",
      },
    );
    const next = JSON.parse(
      readFileSync(process.env.AXIOM_AUCTION_FIXTURE! + ".next", "utf8"),
    ) as Pick<Fixture, "firstTokenId" | "eligibleAt">;
    await moveTo(next.eligibleAt);
    for (const [pageNum, tokenId, floor, nextMinimum] of [
      [1, f.firstTokenId + 1, "0.001", "0.0011"],
      [0, next.firstTokenId, "0.002", "0.0022"],
    ] as const) {
      await page.goto("/auctions?page=" + (pageNum + 1), {
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
          page.getByRole("button", { name: "Place bid", exact: true }),
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
