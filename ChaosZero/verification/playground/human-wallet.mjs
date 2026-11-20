// A dedicated browser window uses one of the disposable node's unlocked human accounts.
// The signing bridge exists only in this process and only for the three playground origins.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { sessionPath } from "./control.mjs";
import { formatEther, Interface, isAddress, MaxUint256 } from "ethers";

const siteRequire = createRequire(
  new URL("../../../Cosmic-Signature-frontend/package.json", import.meta.url),
);
const reads = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

function localOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.href !== url.origin + "/"
  )
    throw new Error("Expected a local playground origin");
  return url.origin;
}

export function walletSession(session, index) {
  const wallet = session.humanWallets?.find((account) => account.index === index);
  if (
    ![1, 2, 3].includes(index) ||
    !wallet ||
    !isAddress(wallet.address) ||
    !/^0x[\da-f]{64}$/i.test(session.instanceId)
  )
    throw new Error("Select a funded human wallet (1, 2 or 3) from an active V4 session.");
  const sites = [session.cosmicUrl, session.chaosUrl, session.axiomUrl].map(localOrigin);
  return {
    address: wallet.address,
    index,
    sites,
    rpc: localOrigin(session.rpcUrl),
    instance: session.instanceId,
  };
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "error",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Local RPC returned HTTP ${response.status}`);
  const reply = await response.json();
  if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
  return reply.result;
}

export async function assertSession(wallet) {
  const [state, accounts] = await Promise.all([
    rpc(wallet.rpc, "hardhat_metadata"),
    rpc(wallet.rpc, "eth_accounts"),
  ]);
  if (accounts[wallet.index]?.toLowerCase() !== wallet.address.toLowerCase())
    throw new Error("The funded account no longer matches this wallet window.");
  if (state.chainId !== 31337 || state.instanceId !== wallet.instance)
    throw new Error("This V4 session ended. Open a wallet for the current playground.");
}

// Only an ordinary transaction from the chosen account can reach eth_sendTransaction.
export function checkedTransaction(wallet, params) {
  const tx = params?.[0];
  if (
    !tx ||
    tx.from?.toLowerCase() !== wallet.address.toLowerCase() ||
    !isAddress(tx.to) ||
    (tx.chainId != null && BigInt(tx.chainId) !== 31337n)
  )
    throw new Error("Transaction does not belong to this local wallet and chain.");
  const request = { from: wallet.address, to: tx.to };
  const quantities = [
    "value",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "type",
  ];
  for (const [key, value] of Object.entries(tx)) {
    if (["to", "from", "chainId"].includes(key)) continue;
    if (key !== "data" && !quantities.includes(key))
      throw new Error("Unsupported transaction field: " + key);
    const hex = key === "data" ? /^0x(?:[\da-f]{2})*$/i : /^0x[\da-f]+$/i;
    if (typeof value !== "string" || !hex.test(value))
      throw new Error("Malformed transaction field: " + key);
    request[key] = value;
  }
  return request;
}

export async function enableWallet(context, session, index) {
  const wallet = walletSession(session, index);
  await assertSession(wallet);
  const contractNames = {
    game: "CosmicSignatureGameV4",
    market: "GameFundedOutcomeMarket",
    auction: "CosmicSignatureArtAuction",
    cst: "CosmicSignatureToken",
    nft: "CosmicSignatureNft",
  };
  const contracts = new Map(
    await Promise.all(
      Object.entries(contractNames).map(async ([key, name]) => {
        const folder =
          key === "market"
            ? "../../out"
            : "../../../Cosmic-Signature/artifacts/production/contracts/production";
        const artifact = JSON.parse(
          await readFile(new URL(`${folder}/${name}.sol/${name}.json`, import.meta.url), "utf8"),
        );
        return [session[key].toLowerCase(), { name, abi: new Interface(artifact.abi) }];
      }),
    ),
  );
  let reviewing = false;
  await context.exposeBinding("__localWalletRequest", async ({ page, frame }, method, params) => {
    try {
      if (frame !== page.mainFrame() || !wallet.sites.includes(new URL(frame.url()).origin))
        throw new Error("This site is outside the local playground.");
      if (reads.has(method)) return { result: await rpc(wallet.rpc, method, params) };
      if (method !== "eth_sendTransaction")
        throw Object.assign(new Error("Unsupported local wallet method: " + method), {
          code: 4200,
        });
      const tx = checkedTransaction(wallet, params);
      if (reviewing) throw new Error("Finish the open wallet confirmation first.");
      reviewing = true;
      try {
        await assertSession(wallet);
        const contract = contracts.get(tx.to.toLowerCase());
        const call =
          contract && tx.data && tx.data !== "0x"
            ? contract.abi.parseTransaction({ data: tx.data })
            : null;
        const args =
          call?.fragment.inputs.map((input, i) => {
            const value = call.args[i];
            const quantity =
              contract.name === "CosmicSignatureToken" &&
              ["approve", "transfer"].includes(call.name) &&
              i === 1;
            return `  ${input.name || i}: ${quantity ? (value === MaxUint256 ? "Unlimited CST" : formatEther(value) + " CST") : String(value)}`;
          }) ?? [];
        const summary = [
          "Wallet " + index + "   ·   Local chain 31337",
          "Site: " + new URL(frame.url()).origin,
          "From: " + wallet.address,
          "To: " + (contract ? contract.name + "   " : "") + tx.to,
          "Value: " + formatEther(tx.value || 0n) + " ETH",
          "Action: " + (call?.name ?? (tx.data && tx.data !== "0x" ? "Contract call" : "Send ETH")),
          ...args,
        ].join("\n");
        const review = await context.newPage();
        let approved;
        try {
          await review.setContent(
            await readFile(new URL("./wallet-confirm.html", import.meta.url), "utf8"),
          );
          await review.bringToFront();
          approved = await review.evaluate(
            (message) => {
              document.querySelector("#summary").textContent = message.summary;
              document.querySelector("#data").textContent = message.data;
              return new Promise((resolve) => {
                document.querySelector("form").onsubmit = (event) => {
                  event.preventDefault();
                  resolve(event.submitter?.value === "confirm");
                };
              });
            },
            { summary, data: tx.data || "0x" },
          );
        } catch (err) {
          if (!review.isClosed()) throw err;
        } finally {
          await review.close().catch(() => {});
        }
        if (!approved)
          throw Object.assign(new Error("Transaction rejected by user."), { code: 4001 });
        await assertSession(wallet);
        await page.bringToFront();
        return { result: await rpc(wallet.rpc, method, [tx]) };
      } finally {
        reviewing = false;
      }
    } catch (err) {
      return {
        error: { code: Number.isInteger(err.code) ? err.code : -32603, message: err.message },
      };
    }
  });
  await context.addInitScript(({ address, index, sites }) => {
    if (window !== window.top || !sites.includes(location.origin)) return;
    const storageKey = "cosmic.local.wallet." + address;
    const permissions = [{ parentCapability: "eth_accounts" }];
    const listeners = new Map();
    function emit(accounts) {
      for (const fn of listeners.get("accountsChanged") ?? []) fn(accounts);
    }
    const provider = {
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return provider;
      },
      removeListener(event, fn) {
        listeners.get(event)?.delete(fn);
        return provider;
      },
      async request({ method, params = [] }) {
        const connected = localStorage.getItem(storageKey) === "1";
        switch (method) {
          case "eth_chainId":
            return "0x7a69";
          case "net_version":
            return "31337";
          case "eth_accounts":
            return connected ? [address] : [];
          case "wallet_getPermissions":
            return connected ? permissions : [];
          case "wallet_requestPermissions":
          case "eth_requestAccounts":
            localStorage.setItem(storageKey, "1");
            if (!connected) emit([address]);
            return method === "eth_requestAccounts" ? [address] : permissions;
          case "wallet_revokePermissions":
            localStorage.removeItem(storageKey);
            emit([]);
            return null;
          case "wallet_switchEthereumChain":
            if (params[0]?.chainId === "0x7a69") return null;
            throw Object.assign(new Error("This wallet is local to chain 31337."), { code: 4902 });
          case "eth_sendTransaction":
            if (!connected)
              throw Object.assign(new Error("Connect this wallet first."), { code: 4100 });
        }
        const reply = await window.__localWalletRequest(method, params);
        if (reply.error)
          throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.result;
      },
    };
    const info = Object.freeze({
      uuid: crypto.randomUUID(),
      name: "Playground Wallet " + index,
      rdns: "local.cosmicsignature.playground",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23232c47'/><circle cx='16' cy='16' r='8' fill='%23f9c866'/></svg>",
    });
    const announce = () =>
      dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    if (!window.ethereum) Object.defineProperty(window, "ethereum", { value: provider });
    announce();
  }, wallet);
  return wallet;
}

async function main() {
  const session = JSON.parse(
    await readFile(sessionPath, "utf8").catch(() => {
      throw new Error("Run make play and wait for the three sites to be ready first.");
    }),
  );
  const index = Number(process.argv[2] || 1);
  const wallet = walletSession(session, index);
  await assertSession(wallet);
  const { chromium } = siteRequire("@playwright/test");
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: null, serviceWorkers: "block" });
    await enableWallet(context, session, index);
    await context.route(/^https?:\/\//, (route) => {
      const local = ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(route.request().url()).hostname,
      );
      return local ? route.continue() : route.abort();
    });
    await context.routeWebSocket(
      (url) => !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      (socket) => socket.close(),
    );
    const closed = new Promise((resolve) => browser.once("disconnected", resolve));
    const pages = await Promise.all(wallet.sites.map(() => context.newPage()));
    await Promise.all(
      pages.map((page, i) =>
        page.goto(wallet.sites[i] + ["/experimental-ui", "/", "/auctions"][i], {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        }),
      ),
    );
    await pages[0].bringToFront();
    console.log(
      `Wallet ${index}: ${wallet.address}\nChoose Playground Wallet ${index} in each site's wallet picker. Review each transaction in the confirmation tab.`,
    );
    await closed;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
