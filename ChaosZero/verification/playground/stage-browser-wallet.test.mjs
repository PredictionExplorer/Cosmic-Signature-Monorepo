import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { browserWalletSession, stageBrowserWallet } from "./stage-browser-wallet.mjs";

const address = (n) => "0x" + n.toString(16).padStart(40, "0");
const manifest = {
  instanceId: "0x" + "ab".repeat(32),
  cosmicUrl: "http://localhost:14670",
  rpcUrl: "http://127.0.0.1:18564",
  game: address(10),
  market: address(11),
  auction: address(12),
  cst: address(13),
  nft: address(14),
  humanWallets: [1, 2, 3].map((index) => ({
    index,
    address: address(index),
    internal: "PRIVATE_METADATA",
  })),
  controlSocket: "PRIVATE_METADATA",
  botWallets: [],
};
const markets = ["http://127.0.0.1:4671", "http://127.0.0.1:4672"];
test("only the live loopback origins and funded human addresses enter the staged script", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stage-browser-wallet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scratch = join(root, ".harness");
  await mkdir(scratch);
  const file = join(scratch, "v4.json");
  await writeFile(file, JSON.stringify(manifest));
  await stageBrowserWallet(root, file, ...markets);
  const script = await readFile(join(root, "instrumentation-client.js"), "utf8");
  assert.ok(script.includes(manifest.instanceId));
  assert.ok(script.includes(address(3)));
  assert.ok(!script.includes("PRIVATE_METADATA"));
  await assert.rejects(stageBrowserWallet(root, file, ...markets), { code: "EEXIST" });
  await assert.rejects(
    stageBrowserWallet(root, join(root, "unrelated.json"), ...markets),
    /own interactive deployment/,
  );
  assert.throws(() =>
    browserWalletSession({ ...manifest, rpcUrl: "https://example.org" }, ...markets),
  );
  assert.throws(() =>
    browserWalletSession(
      { ...manifest, humanWallets: [{ index: 7, address: address(7) }] },
      ...markets,
    ),
  );
});
