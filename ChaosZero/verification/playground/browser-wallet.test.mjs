import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { installBrowserWallet } from "./browser-wallet.mjs";

const addresses = [1, 2, 3].map((i) => "0x" + String(i).repeat(40));
const session = {
  instanceId: "0x" + "ab".repeat(32),
  rpcUrl: "http://127.0.0.1:38545",
  cosmicUrl: "http://localhost:3111",
  chaosUrl: "http://127.0.0.1:3112",
  axiomUrl: "http://127.0.0.1:3113",
  humanWallets: addresses.map((address, i) => ({ index: i + 1, address })),
};

function tab({
  origin = session.cosmicUrl,
  top = true,
  saved = new Map(),
  manifest = session,
  dedicated = false,
  extension,
  metadata,
} = {}) {
  const window = new EventTarget();
  window.top = top ? window : {};
  if (extension) window.ethereum = extension;
  if (dedicated) window.__localWalletRequest = () => {};
  const rpc = [];
  let local;
  window.addEventListener("eip6963:announceProvider", (event) => {
    local = event.detail.provider;
  });
  // Hydration and trusted confirmation are covered separately with a real browser.
  const context = {
    window,
    URL,
    crypto: { randomUUID },
    CustomEvent,
    AbortSignal,
    document: { readyState: "loading", addEventListener() {} },
    location: new URL(origin),
    manifest,
    sessionStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    async fetch(url, options) {
      assert.equal(url, session.rpcUrl);
      assert.equal(options.redirect, "error");
      const { method } = JSON.parse(options.body);
      rpc.push(method);
      const result =
        method === "hardhat_metadata"
          ? metadata
          : method === "eth_accounts"
            ? ["owner", ...addresses]
            : "0x12";
      return { ok: true, json: async () => ({ result }) };
    },
  };
  const script = `(${installBrowserWallet.toString()})(manifest)`;
  runInNewContext(script, context);
  return { window, local, rpc, reinstall: () => runInNewContext(script, context) };
}

test("only the top frame of an exact local site receives an ordinary-browser wallet", () => {
  for (const opts of [
    { origin: "http://localhost:3114" },
    { top: false },
    { dedicated: true },
    { manifest: { ...session, rpcUrl: "https://example.org" } },
    { manifest: { ...session, rpcUrl: "http://user@localhost:38545" } },
    { manifest: { ...session, instanceId: "bad" } },
    {
      manifest: {
        ...session,
        humanWallets: [...session.humanWallets.slice(0, 2), { index: 3, address: addresses[0] }],
      },
    },
  ])
    assert.equal(tab(opts).local, undefined);
  for (const origin of [session.cosmicUrl, session.chaosUrl, session.axiomUrl])
    assert.ok(tab({ origin }).local);
});

test("announces a local account once across hot reload without invoking an extension", async () => {
  const extension = {
    request() {
      assert.fail("Local wallet invoked a personal extension");
    },
  };
  const t = tab({ extension });
  assert.equal(t.window.ethereum, extension);
  const providers = [];
  t.window.addEventListener("eip6963:announceProvider", (event) =>
    providers.push(event.detail.provider),
  );
  t.reinstall();
  t.window.dispatchEvent(new Event("eip6963:requestProvider"));
  assert.deepEqual(providers, [t.local]);
  assert.deepEqual(Array.from(await t.local.request({ method: "eth_accounts" })), [addresses[0]]);
});

test("remembers a tab's selected account and an explicit disconnect on reload", async () => {
  const saved = new Map([["cosmic.playground.wallet." + session.instanceId, "2"]]);
  const { local } = tab({ saved });
  assert.deepEqual(Array.from(await local.request({ method: "eth_accounts" })), [addresses[1]]);
  const changes = [];
  local.on("accountsChanged", (value) => changes.push(Array.from(value)));
  await local.request({ method: "wallet_revokePermissions" });
  assert.deepEqual(changes, [[]]);
  const fresh = tab({ saved }).local;
  assert.deepEqual(Array.from(await fresh.request({ method: "eth_accounts" })), []);
  assert.deepEqual(Array.from(await fresh.request({ method: "eth_requestAccounts" })), [
    addresses[0],
  ]);
});

test("rejects unsupported methods, mismatched accounts and replaced nodes before review", async () => {
  const t = tab({ metadata: { chainId: 31337, instanceId: "0x" + "cd".repeat(32) } });
  const tx = { from: addresses[0], to: addresses[1], value: "0x1" };
  const send = (input) => t.local.request({ method: "eth_sendTransaction", params: [input] });
  for (const change of [
    { from: addresses[1] },
    { to: "not an address" },
    { chainId: "0x1" },
    { value: "0x" },
    { data: "0xab0" },
    { input: "0xff" },
  ])
    await assert.rejects(send({ ...tx, ...change }));
  await assert.rejects(t.local.request({ method: "eth_sendRawTransaction", params: [] }), {
    code: 4200,
  });
  assert.deepEqual(t.rpc, []);
  assert.equal(await t.local.request({ method: "eth_blockNumber" }), "0x12");
  await assert.rejects(send(tx), { code: 4901 });
  assert.deepEqual(t.rpc, ["eth_blockNumber", "hardhat_metadata", "eth_accounts"]);
});
