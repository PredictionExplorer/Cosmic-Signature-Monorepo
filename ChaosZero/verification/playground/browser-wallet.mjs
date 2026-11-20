// Staged into the three disposable Next sites only. The stager serializes this
// function with a public subset of the local session, so keep it self-contained.
export function installBrowserWallet(session) {
  if (typeof window === "undefined" || window.top !== window || window.__localWalletRequest) return;
  const origins = [session.cosmicUrl, session.chaosUrl, session.axiomUrl];
  function localOrigin(input) {
    if (typeof input !== "string") return false;
    try {
      const url = new URL(input);
      return (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.origin === input
      );
    } catch {
      return false;
    }
  }
  if (
    !origins.every(localOrigin) ||
    !origins.includes(location.origin) ||
    !localOrigin(session.rpcUrl)
  )
    return;
  const { instanceId, rpcUrl } = session;
  const human = session.humanWallets;
  const addressPattern = /^0x[\da-f]{40}$/i;
  if (
    !/^0x[\da-f]{64}$/i.test(instanceId) ||
    !Array.isArray(human) ||
    human.length !== 3 ||
    !human.every((w, i) => w.index === i + 1 && addressPattern.test(w.address))
  )
    return;
  const addresses = human.map((w) => w.address);
  if (new Set(addresses.map((a) => a.toLowerCase())).size !== 3) return;

  const marker = Symbol.for("cosmicsignature.playground.browser-wallet");
  if (window[marker]) return;
  const storageKey = "cosmic.playground.wallet." + instanceId;
  const saved = sessionStorage.getItem(storageKey);
  let active = saved !== null && /^[0-3]$/.test(saved) ? Number(saved) : 1;
  let select;
  let root;
  let reviewing = false;
  const listeners = new Map();
  const account = () => addresses[active - 1];
  const accounts = () => (active ? [account()] : []);
  const errors = (message, code) => Object.assign(new Error(message), { code });
  const permission = () => (active ? [{ parentCapability: "eth_accounts" }] : []);
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

  function choose(index) {
    if (!Number.isInteger(index) || index < 0 || index > 3 || index === active) return;
    active = index;
    sessionStorage.setItem(storageKey, String(index));
    if (select) select.value = String(index);
    for (const fn of listeners.get("accountsChanged") ?? []) fn(accounts());
  }

  async function rpc(method, params = []) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw errors("Local RPC unavailable", -32603);
    const result = await response.json();
    if (result.error) throw errors(result.error.message, result.error.code);
    return result.result;
  }

  async function verify(index) {
    const [state, unlocked] = await Promise.all([rpc("hardhat_metadata"), rpc("eth_accounts")]);
    if (
      active !== index ||
      state.chainId !== 31337 ||
      state.instanceId !== instanceId ||
      unlocked[index]?.toLowerCase() !== addresses[index - 1].toLowerCase()
    ) {
      throw errors(
        "The local session or wallet changed. Reload and review the action again.",
        4901,
      );
    }
  }

  function ordinaryTransaction(params, from) {
    const tx = params?.[0];
    if (
      !tx ||
      tx.from?.toLowerCase() !== from.toLowerCase() ||
      !addressPattern.test(tx.to) ||
      (tx.chainId != null && BigInt(tx.chainId) !== 31337n)
    )
      throw errors("Wrong local account, recipient or chain", 4100);
    const request = { from, to: tx.to };
    for (const [key, value] of Object.entries(tx)) {
      if (["from", "to", "chainId"].includes(key)) continue;
      const quantity = [
        "value",
        "gas",
        "gasPrice",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
        "nonce",
        "type",
      ].includes(key);
      if (
        (!quantity && key !== "data") ||
        typeof value !== "string" ||
        !(quantity ? /^0x[\da-f]+$/i : /^0x(?:[\da-f]{2})*$/i).test(value)
      )
        throw errors("Unsupported local transaction field: " + key, -32602);
      request[key] = value;
    }
    return request;
  }

  function element(tag, text) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function mount() {
    if (root || !document.body) return;
    const host = element("div");
    host.id = "cosmic-playground-wallet";
    root = host.attachShadow({ mode: "open" });
    const style = element(
      "style",
      `
      :host{position:fixed;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:2147483000;color-scheme:dark;font:14px/1.45 system-ui,sans-serif;color:#f2f4ff}
      label{display:flex;align-items:center;gap:7px;padding:6px 9px;background:#202636;border:1px solid #8e96ad;border-radius:8px;box-shadow:0 2px 9px #0006}
      select,button{font:inherit;background:#151a27;color:inherit;border:1px solid #a3aabe;border-radius:4px;padding:5px}
      select:focus-visible,button:focus-visible{outline:3px solid #ffc960;outline-offset:2px}
      dialog{box-sizing:border-box;width:min(34rem,94vw);max-height:85vh;overflow:auto;border:1px solid #929bb2;border-radius:10px;background:#181d2b;color:#f2f4ff;padding:1.25rem}
      dialog::backdrop{background:#101421b8} h2{margin:0 0 .8rem;font-size:1.25rem}
      pre{white-space:pre-wrap;overflow-wrap:anywhere} details pre{max-height:8rem;overflow:auto}
      footer{display:flex;gap:.6rem;margin-top:1rem} button{padding:.55rem .85rem;cursor:pointer}
      button:last-child{background:#ffcf76;color:#151823}
      @media(max-width:600px){:host{bottom:auto;top:calc(3.8rem + env(safe-area-inset-top));right:5px}label{flex-direction:column;gap:0;padding:3px 5px;font-size:11px}select{font-size:12px}}
    `,
    );
    const label = element("label", "Playground wallet");
    select = element("select");
    select.setAttribute("aria-label", "Playground wallet");
    for (const [i, address] of ["", ...addresses].entries()) {
      const option = element(
        "option",
        i ? `Wallet ${i} · ${address.slice(0, 6)}…${address.slice(-4)}` : "Disconnected",
      );
      option.value = String(i);
      select.append(option);
    }
    select.value = String(active);
    select.addEventListener("change", () => choose(Number(select.value)));
    label.append(select);
    root.append(style, label);
    document.body.append(host);
  }

  function formatAmount(raw) {
    const wei = BigInt(raw || 0)
      .toString()
      .padStart(19, "0");
    return (wei.slice(0, -18) + "." + wei.slice(-18)).replace(/\.?0+$/, "");
  }

  async function review(tx, index) {
    mount();
    if (!root) throw errors("The wallet view is not ready.", -32002);
    const dialog = element("dialog");
    dialog.setAttribute("aria-label", "Review local transaction");
    const recipient = tx.to.toLowerCase();
    const name = ["game", "market", "auction", "cst", "nft"].find(
      (k) => session[k]?.toLowerCase() === recipient,
    );
    const summary = [
      `Wallet ${index} · Local chain 31337`,
      location.origin,
      "From: " + tx.from,
      "To: " + (name ? name.toUpperCase() + " · " : "") + tx.to,
      "Value: " + formatAmount(tx.value) + " ETH",
    ];
    const data = tx.data || "0x";
    if (name === "cst" && /^0x(?:095ea7b3|a9059cbb)[\da-f]{128}$/i.test(data)) {
      const approval = data.slice(2, 10).toLowerCase() === "095ea7b3";
      const amount = data.slice(74);
      summary.push(
        (approval ? "Approve " : "Transfer ") +
          (/^f{64}$/i.test(amount) ? "unlimited" : formatAmount("0x" + amount)) +
          " CST " +
          (approval ? "for " : "to ") +
          "0x" +
          data.slice(34, 74),
      );
    }
    const details = element("details");
    details.append(element("summary", "Call data"), element("pre", data));
    const actions = element("footer");
    const cancel = element("button", "Cancel"),
      confirm = element("button", "Confirm transaction");
    cancel.autofocus = true;
    actions.append(cancel, confirm);
    dialog.append(
      element("h2", "Review local transaction"),
      element("pre", summary.join("\n")),
      details,
      actions,
    );
    root.append(dialog);
    try {
      return await new Promise((resolve) => {
        let approved = false;
        dialog.addEventListener("close", () => resolve(approved), {
          once: true,
        });
        cancel.addEventListener("click", () => dialog.close());
        confirm.addEventListener("click", (event) => {
          if (!event.isTrusted) return;
          approved = true;
          dialog.close();
        });
        dialog.showModal();
      });
    } finally {
      dialog.remove();
    }
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
      if (method === "eth_chainId") return "0x7a69";
      if (method === "net_version") return "31337";
      if (method === "eth_accounts") return accounts();
      if (method === "wallet_getPermissions") return permission();
      if (method === "eth_requestAccounts" || method === "wallet_requestPermissions") {
        if (!active) choose(1);
        return method === "eth_requestAccounts" ? accounts() : permission();
      }
      if (method === "wallet_revokePermissions") {
        choose(0);
        return null;
      }
      if (method === "wallet_switchEthereumChain") {
        if (params[0]?.chainId?.toLowerCase() === "0x7a69") return null;
        throw errors("This wallet only serves the local playground chain.", 4902);
      }
      if (reads.has(method)) return rpc(method, params);
      if (method !== "eth_sendTransaction")
        throw errors("Unsupported local wallet method: " + method, 4200);
      if (!active) throw errors("Connect a playground wallet first.", 4100);
      if (reviewing) throw errors("Finish the open wallet confirmation first.", -32002);
      const index = active,
        tx = ordinaryTransaction(params, account());
      reviewing = true;
      try {
        await verify(index);
        if (!(await review(tx, index))) throw errors("Transaction rejected by user.", 4001);
        await verify(index);
        return await rpc(method, [tx]);
      } finally {
        reviewing = false;
      }
    },
  };
  const info = Object.freeze({
    uuid: crypto.randomUUID(),
    name: "Playground Wallet",
    rdns: "local.cosmicsignature.playground",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23232c47'/><circle cx='16' cy='16' r='8' fill='%23f9c866'/></svg>",
  });
  const detail = Object.freeze({ info, provider });
  Object.defineProperty(window, marker, { value: provider });
  // Keep personal extension providers separate. The dApp discovers this local account via EIP-6963.
  if (!window.ethereum) Object.defineProperty(window, "ethereum", { value: provider });
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
