import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { control, controlSession } from "./control.mjs";

const file = process.argv[2];
const session = JSON.parse(readFileSync(file, "utf8"));
const command = (...args) => control(args, file);
// A stale ready file must not be able to mutate another local session.
await assert.rejects(
  controlSession(["bots", "3"], {
    ...session,
    instanceId: "0x" + (session.instanceId[2] === "a" ? "b" : "a").repeat(64),
  }),
  /different session/,
);
const initial = await command("status");
assert.equal(initial.instanceId, session.instanceId);
assert.equal(initial.bots, 0);
assert.equal(session.humanWallets.length, 3);
assert.equal(session.botWallets.length, 3);
assert.equal(
  new Set([...session.humanWallets, ...session.botWallets].map((w) => w.address.toLowerCase()))
    .size,
  6,
);

execFileSync(
  process.execPath,
  [join(process.env.CHAOS_ZERO_ROOT, "verification/playground/human-wallet.smoke.mjs"), file],
  {
    stdio: "inherit",
    timeout: 180_000,
  },
);

const port = Number(process.env.HARNESS_CHAIN_PORT);
assert.ok(Number.isSafeInteger(port) && port >= 1 && port <= 65535);
const rpcUrl = "http://127.0.0.1:" + port;
assert.equal(session.rpcUrl, rpcUrl);
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  assert.ok(response.ok && !body.error);
  return body.result;
}
const metadata = await rpc("hardhat_metadata");
assert.equal(BigInt(metadata.chainId), 31337n);
assert.equal(metadata.instanceId, initial.instanceId);
const botAddresses = (await rpc("eth_accounts")).slice(7, 10);
assert.deepEqual(
  botAddresses.map((a) => a.toLowerCase()),
  session.botWallets.map((w) => w.address.toLowerCase()),
);
async function nonces() {
  return Promise.all(
    botAddresses.map(async (address) =>
      BigInt(await rpc("eth_getTransactionCount", [address, "latest"])),
    ),
  );
}
const before = await nonces();
assert.equal((await command("bots", "3")).bots, 3);
assert.equal((await command("status")).bots, 3);
const deadline = Date.now() + 120_000;
while ((await nonces()).every((value, i) => value === before[i])) {
  assert.ok(Date.now() < deadline, "Expected a confirmed transaction from a bot wallet");
  await sleep(1000);
}
await command("bots", "0");
assert.equal((await command("status")).bots, 0);
const { chainTime } = await command("status");
await command("advance", "3600");
assert.ok((await command("status")).chainTime >= chainTime + 3600);
assert.equal((await command("stop")).stopping, true);
console.log("Verified session controls, confirmed bot activity, clock advance and shutdown.");
