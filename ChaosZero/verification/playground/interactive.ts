import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
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

type ControlCommand =
  | { command: "status" }
  | { command: "stop" }
  | { command: "stopBots" }
  | { command: "startBots"; value: number }
  | { command: "advance"; value: number };

// Only these four operations are exposed by the owner-only control socket.
function readCommand(line: string): ControlCommand | undefined {
  let input;
  try {
    input = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const { command, value } = input;
  if (Object.keys(input).some((key) => key !== "command" && key !== "value")) return undefined;
  if (command === "status" && value === undefined) return { command: "status" };
  if (command === "stop" && value === undefined) return { command: "stop" };
  if (!Number.isSafeInteger(value)) return undefined;
  if (command === "bots" && value === 0) return { command: "stopBots" };
  if (command === "bots" && value >= 1 && value <= 3) return { command: "startBots", value };
  if (command === "advance" && value > 0 && value <= 31 * 86400)
    return { command: "advance", value };
  return undefined;
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
  const sessionPath = smoke
    ? join(config.runDir, "session.json")
    : join(process.env.CHAOS_ZERO_ROOT!, "../.local/v4-playground/session.json");
  mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
  // A short private path fits sockaddr_un on both Darwin and Linux. No TCP listener is needed.
  const base = Buffer.byteLength(join(tmpdir(), "csv4-XXXXXX", "ctl")) <= 100 ? tmpdir() : "/tmp";
  const controlDir = mkdtempSync(join(base, "csv4-"));
  const controlSocket = join(controlDir, "ctl");
  const session = {
    ...manifest,
    manifestPath,
    cosmicUrl: manifest.cosmicUrl,
    chaosUrl,
    axiomUrl,
    controlSocket,
    pid: process.pid,
    logs: join(config.runDir, "logs"),
  };
  let bot: ManagedProcess | undefined;
  let botCount = 0;
  let botError: string | null = null;
  const checkBotWorker = () => {
    if (!bot || isProcessAlive(bot.pid)) return;
    botError = `Bot worker exited. See bots.log; restart with make play-bots BOTS=${botCount}.`;
    console.error(botError);
    bot = undefined;
    botCount = 0;
  };
  const stopBots = async () => {
    const worker = bot;
    // Remove the worker from monitoring before requesting an intentional stop.
    bot = undefined;
    botCount = 0;
    botError = null;
    if (worker) await stopProcessGroup(worker.pid);
  };
  const startBots = async (count: number) => {
    // Verify the bound node before keeping, replacing or spawning a bot worker.
    await verifyChain();
    checkBotWorker();
    if (bot && count === botCount) return;
    await stopBots();
    bot = spawnSupervised({
      name: "bots",
      command: process.execPath,
      args: [join(process.env.CHAOS_ZERO_ROOT!, "verification/playground/bots.mjs")],
      cwd: config.frontendDir,
      env: { V4_BOT_SEED: String(botSeed), V4_BOT_COUNT: String(count) },
      logFile: join(session.logs, "bots.log"),
    });
    botCount = count;
  };
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const lifetime = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  let busy = false;
  const clients = new Set<Socket>();
  async function dispatch(command: ControlCommand) {
    if (command.command === "status") {
      await verifyChain();
      const block = await jsonRpc<{ timestamp: string; number: string }>(
        rpc,
        "eth_getBlockByNumber",
        ["latest", false],
      );
      checkBotWorker();
      return {
        ok: true,
        result: {
          instanceId: manifest.instanceId,
          game: deployment.game,
          cosmicUrl: session.cosmicUrl,
          chaosUrl,
          axiomUrl,
          rpcUrl: rpc,
          chainTime: Number(BigInt(block.timestamp)),
          blockNumber: Number(BigInt(block.number)),
          bots: botCount,
          botError,
          logs: session.logs,
        },
      };
    }
    if (busy) return { ok: false, error: "Another local control command is in progress" };
    busy = true;
    try {
      if (command.command === "stop") return { ok: true, result: { stopping: true } };
      if (command.command === "startBots" || command.command === "stopBots") {
        if (command.command === "startBots") await startBots(command.value);
        else await stopBots();
        return { ok: true, result: { bots: botCount, seed: botSeed } };
      }
      await verifyChain();
      await jsonRpc(rpc, "evm_increaseTime", [command.value]);
      await jsonRpc(rpc, "evm_mine");
      const block = await jsonRpc<{ timestamp: string }>(rpc, "eth_getBlockByNumber", [
        "latest",
        false,
      ]);
      return {
        ok: true,
        result: { advancedSeconds: command.value, chainTime: Number(BigInt(block.timestamp)) },
      };
    } finally {
      busy = false;
    }
  }
  const server = createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(30_000, () => socket.destroy());
    socket.setEncoding("utf8");
    socket.write(JSON.stringify({ instanceId: manifest.instanceId }) + "\n");
    let frame = "";
    socket.on("data", (chunk: string) => {
      frame += chunk;
      if (Buffer.byteLength(frame) > 512) {
        socket.pause();
        socket.end('{"ok":false,"error":"Control request too large"}\n');
        return;
      }
      const newline = frame.indexOf("\n");
      if (newline < 0) return;
      socket.pause(); // Each connection carries one command.
      const command =
        newline === frame.length - 1 ? readCommand(frame.slice(0, newline)) : undefined;
      if (!command) {
        socket.end('{"ok":false,"error":"Invalid control command"}\n');
        return;
      }
      void dispatch(command)
        .then((result) => {
          socket.end(JSON.stringify(result) + "\n");
          if (result.ok && command.command === "stop") finish();
        })
        .catch((error) => {
          console.error("Local playground control failed", error);
          socket.end(
            '{"ok":false,"error":"Control command failed. See the playground terminal."}\n',
          );
        });
    });
  });
  let monitor;
  const pendingSession = sessionPath + "." + randomUUID() + ".tmp";
  let published = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject).listen(controlSocket, resolve);
    });
    chmodSync(controlSocket, 0o600);
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
    if (initialCount > 0) await startBots(initialCount);
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
        "\n\nOpen a site above and pick a funded playground wallet. For a dedicated window, run make play-wallet WALLET=1. Press Ctrl+C here to stop.\n",
    );
    monitor = setInterval(() => {
      const exited = services.find((p) => !isProcessAlive(p.pid));
      if (exited) fail(new Error(exited.name + " exited; see " + exited.logFile));
      checkBotWorker();
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
    if (server.listening) {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of clients) socket.destroySoon();
      await closed;
    }
    rmdirSync(controlDir);
    rmSync(pendingSession, { force: true });
    await stopBots();
  }
}
