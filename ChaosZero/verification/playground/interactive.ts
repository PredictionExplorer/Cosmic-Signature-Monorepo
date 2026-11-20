import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import type { HarnessConfig } from "../../scripts/harness/config";
import {
  isProcessAlive,
  runBlocking,
  spawnSupervised,
  stopProcessGroup,
  type ManagedProcess,
} from "../../scripts/harness/processes";
import { jsonRpc } from "../../scripts/harness/rpc";
import { axiomUrl, chaosUrl, deployment } from "./deployment";

function numberInRange(raw: string, min: number, max: number) {
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new Error(`Expected a number between ${min} and ${max}`);
  return Number(raw);
}

interface SessionManifest {
  instanceId: string;
  humanWallets: { index: number; address: string }[];
  botWallets: { index: number; address: string }[];
}

// Keep HMR, indexing, contracts and local wallets alive until the owner requests shutdown.
export async function runInteractive(
  config: HarnessConfig,
  services: ManagedProcess[],
  signal: AbortSignal,
  smoke: boolean,
) {
  const manifestPath = process.env.V4_PLAYGROUND_MANIFEST!;
  const manifest: SessionManifest & typeof deployment = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  const rpc = manifest.rpcUrl;
  async function verifyChain() {
    const metadata = await jsonRpc<{ instanceId: string; chainId: number }>(
      rpc,
      "hardhat_metadata",
    );
    if (metadata.chainId !== 31337 || metadata.instanceId !== manifest.instanceId)
      throw new Error("The connected node is no longer this local V4 session.");
  }
  await verifyChain();
  const botSeed = numberInRange(process.env.V4_BOT_SEED ?? "42", 0, 0xffffffff);
  const initialCount = smoke ? 0 : numberInRange(process.env.V4_BOT_COUNT ?? "0", 0, 3);
  const controlToken = randomBytes(32).toString("hex");
  const controlUrl = "http://127.0.0.1:" + config.controlPort;
  const sessionPath = smoke
    ? join(config.runDir, "session.json")
    : join(process.env.CHAOS_ZERO_ROOT!, "../.local/v4-playground/session.json");
  mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
  const session = {
    ...manifest,
    manifestPath,
    cosmicUrl: manifest.cosmicUrl,
    chaosUrl,
    axiomUrl,
    controlUrl,
    controlToken,
    pid: process.pid,
    logs: join(config.runDir, "logs"),
  };
  let bot: ManagedProcess | undefined;
  let botCount = 0;
  const setBots = async (count: number) => {
    if (bot && count === botCount && isProcessAlive(bot.pid)) return;
    if (bot) await stopProcessGroup(bot.pid);
    bot = undefined;
    botCount = 0;
    if (count) {
      await verifyChain();
      bot = spawnSupervised({
        name: "bots",
        command: process.execPath,
        args: [join(process.env.CHAOS_ZERO_ROOT!, "verification/playground/bots.mjs")],
        cwd: config.frontendDir,
        env: { V4_BOT_SEED: String(botSeed), V4_BOT_COUNT: String(count) },
        logFile: join(session.logs, "bots.log"),
      });
      botCount = count;
    }
  };
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const lifetime = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  let busy = false;
  const server = createServer(async (req, res) => {
    const reply = (code: number, value: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.host !== new URL(controlUrl).host ||
      req.headers.origin !== undefined ||
      req.headers.authorization !== "Bearer " + controlToken
    )
      return reply(403, { error: "Local session authentication required" });
    if (req.method === "GET" && req.url === "/status") {
      try {
        await verifyChain();
        const block = await jsonRpc<{ timestamp: string; number: string }>(
          rpc,
          "eth_getBlockByNumber",
          ["latest", false],
        );
        return reply(200, {
          instanceId: manifest.instanceId,
          game: deployment.game,
          cosmicUrl: session.cosmicUrl,
          chaosUrl,
          axiomUrl,
          rpcUrl: rpc,
          chainTime: Number(BigInt(block.timestamp)),
          blockNumber: Number(BigInt(block.number)),
          bots: bot && isProcessAlive(bot.pid) ? botCount : 0,
          logs: session.logs,
        });
      } catch (error) {
        return reply(503, { error: String(error) });
      }
    }
    if (req.method !== "POST") return reply(405, { error: "POST required" });
    if (busy) return reply(409, { error: "Another local control command is in progress" });
    busy = true;
    try {
      if (req.url === "/stop") {
        reply(200, { stopping: true });
        finish();
        return;
      }
      const match = /^\/(bots|advance)\/(\d+)$/.exec(req.url ?? "");
      if (!match?.[2]) return reply(400, { error: "Unknown control command" });
      if (match[1] === "bots") {
        await setBots(numberInRange(match[2], 0, 3));
        return reply(200, { bots: botCount, seed: botSeed });
      }
      const seconds = numberInRange(match[2], 1, 31 * 86400);
      await verifyChain();
      // Add to the node's current clock so a concurrent transaction or interval block
      // cannot make a previously sampled absolute timestamp invalid.
      await jsonRpc(rpc, "evm_increaseTime", [seconds]);
      await jsonRpc(rpc, "evm_mine");
      const block = await jsonRpc<{ timestamp: string }>(rpc, "eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      return reply(200, { advancedSeconds: seconds, chainTime: Number(BigInt(block.timestamp)) });
    } catch (error) {
      return reply(400, { error: String(error) });
    } finally {
      busy = false;
    }
  });
  let monitor;
  const pendingSession = sessionPath + "." + randomUUID() + ".tmp";
  let published = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject).listen(config.controlPort, "127.0.0.1", resolve);
    });
    // A killed process can leave its ready file behind. Never replace a live session.
    try {
      const previous = JSON.parse(readFileSync(sessionPath, "utf8"));
      if (Number.isSafeInteger(previous.pid) && previous.pid > 0 && isProcessAlive(previous.pid)) {
        // Each run invokes Node with an absolute path inside its unique temporary workspace.
        // A recycled PID therefore cannot claim ownership of a crashed session's ready file.
        const command = spawnSync("ps", ["-ww", "-p", String(previous.pid), "-o", "command="], {
          encoding: "utf8",
          timeout: 2000,
        });
        if (command.error) throw command.error;
        const entry = join(dirname(previous.manifestPath), "../e2e/v4-playground/stack.ts");
        if (command.stdout.includes(entry + " --interactive"))
          throw new Error("A V4 playground session already exists at " + sessionPath);
      }
      rmSync(sessionPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await setBots(initialCount);
    writeFileSync(pendingSession, JSON.stringify(session, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    linkSync(pendingSession, sessionPath);
    published = true;
    rmSync(pendingSession);
    console.log(
      "\nV4 playground ready\n  Game: " +
        manifest.cosmicUrl +
        "\n  Chaos Zero: " +
        chaosUrl +
        "\n  Auctions: " +
        axiomUrl +
        "/auctions\n  Local RPC: " +
        rpc +
        " (31337)\n  Wallets: " +
        manifest.humanWallets.map((w) => "#" + w.index + " " + w.address).join("\n           ") +
        "\n  Bots: " +
        initialCount +
        "\n  Session: " +
        sessionPath +
        "\n  Logs: " +
        session.logs +
        "\n\nOpen a funded wallet with make play-wallet WALLET=1 in another terminal. Press Ctrl+C here to stop.\n",
    );
    monitor = setInterval(() => {
      const exited = [...services, ...(bot ? [bot] : [])].find((p) => !isProcessAlive(p.pid));
      if (exited && !(busy && exited === bot))
        fail(new Error(exited.name + " exited; see " + exited.logFile));
    }, 1000);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
    if (smoke) {
      await Promise.all([
        lifetime,
        runBlocking({
          signal,
          name: "interactive-smoke",
          command: process.execPath,
          args: [
            join(process.env.CHAOS_ZERO_ROOT!, "verification/playground/interactive-smoke.mjs"),
            sessionPath,
          ],
          cwd: config.frontendDir,
          logFile: join(session.logs, "interactive-smoke.log"),
        }),
      ]);
    } else {
      await lifetime;
    }
  } finally {
    signal.removeEventListener("abort", finish);
    clearInterval(monitor);
    if (published) rmSync(sessionPath, { force: true });
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(pendingSession, { force: true });
    await setBots(0);
  }
}
