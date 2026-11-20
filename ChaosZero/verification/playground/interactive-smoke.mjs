import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { control, controlSession } from "./control.mjs";

const file = process.argv[2];
const session = JSON.parse(readFileSync(file, "utf8"));
// This rehearsal may interrupt only the worker of its own private smoke session.
assert.equal(resolve(file), join(dirname(resolve(session.manifestPath)), "session.json"));
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
async function waitForBotTransaction(before) {
  const deadline = Date.now() + 120_000;
  while ((await nonces()).every((value, i) => value === before[i])) {
    assert.ok(Date.now() < deadline, "Expected a confirmed transaction from a bot wallet");
    await sleep(1000);
  }
}

const before = await nonces();
assert.equal((await command("bots", "3")).bots, 3);
await waitForBotTransaction(before);

// Terminate only the private supervisor's own bot child, never the live person's worker.
const workerCommand = join(process.env.CHAOS_ZERO_ROOT, "verification/playground/bots.mjs");
const workers = execFileSync("ps", ["-ww", "-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
  .filter((row) => row && Number(row[2]) === session.pid && row[3].endsWith(" " + workerCommand));
assert.equal(workers.length, 1, "Expected one isolated bot child");
const workerPid = Number(workers[0][1]);
assert.ok(Number.isSafeInteger(workerPid) && workerPid > 1);
process.kill(workerPid, "SIGTERM");
const exitDeadline = Date.now() + 15_000;
while ((await command("status")).bots !== 0) {
  assert.ok(Date.now() < exitDeadline, "Expected optional worker to exit");
  await sleep(200);
}
const interrupted = await command("status");
assert.match(interrupted.botError, /restart with make play-bots/);
assert.equal(interrupted.instanceId, initial.instanceId);
assert.equal((await rpc("hardhat_metadata")).instanceId, initial.instanceId);
const replies = await Promise.all(
  [session.cosmicUrl + "/experimental-ui", session.chaosUrl, session.axiomUrl + "/auctions"].map(
    (url) => fetch(url, { signal: AbortSignal.timeout(30000) }),
  ),
);
assert.ok(
  replies.every((reply) => reply.ok),
  "All three sites must survive the bot worker exit",
);
const afterExit = await nonces();
assert.equal((await command("bots", "2")).bots, 2);
assert.equal((await command("status")).botError, null);
await waitForBotTransaction(afterExit);
await command("bots", "0");
const paused = await command("status");
assert.equal(paused.bots, 0);
assert.equal(paused.botError, null);
const { chainTime } = await command("status");
await command("advance", "3600");
assert.ok((await command("status")).chainTime >= chainTime + 3600);
assert.equal((await command("stop")).stopping, true);
console.log(
  "Verified bot exit isolation, same-chain recovery, confirmed bot activity, clock advance and shutdown.",
);
