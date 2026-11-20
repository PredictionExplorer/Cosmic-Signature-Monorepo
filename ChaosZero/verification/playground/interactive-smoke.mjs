import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { control } from "./control.mjs";

const file = process.argv[2];
const session = JSON.parse(readFileSync(file, "utf8"));
const command = (...args) => control(args, file);
const forbidden = await fetch(session.controlUrl + "/advance/1", { method: "POST" });
assert.equal(forbidden.status, 403);
const crossOrigin = await fetch(session.controlUrl + "/bots/3", {
  method: "POST",
  headers: { authorization: "Bearer " + session.controlToken, origin: session.cosmicUrl },
});
assert.equal(crossOrigin.status, 403);
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

async function nonces() {
  return Promise.all(
    session.botWallets.map(async ({ address }) => {
      const response = await fetch(session.rpcUrl, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionCount",
          params: [address, "latest"],
        }),
      });
      const body = await response.json();
      assert.ok(response.ok && !body.error);
      return BigInt(body.result);
    }),
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
