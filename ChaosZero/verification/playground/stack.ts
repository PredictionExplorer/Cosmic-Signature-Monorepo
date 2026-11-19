// This file runs inside a disposable copy of the Cosmic frontend. Reuse its real
// indexer, database and wallet harness on the same chain as both market sites.
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { resolveHarnessConfig } from "../../scripts/harness/config";
import {
  isProcessAlive,
  runBlocking,
  spawnSupervised,
  stopProcessGroup,
  type ManagedProcess,
} from "../../scripts/harness/processes";
import { dashboardUrl } from "../../scripts/harness/orchestrator/backend";
import {
  ensureDockerUp,
  primeIndexerWatermark,
  registerContractAddresses,
  startDatabase,
  stopDatabase,
} from "../../scripts/harness/orchestrator/database";
import { readDeployReport } from "../../scripts/harness/orchestrator/deploy";
import { testingModeEnv } from "../../scripts/harness/orchestrator/frontend";
import { httpJson, jsonRpc, waitFor, WaitAbortedError } from "../../scripts/harness/rpc";

async function main(): Promise<void> {
  const config = resolveHarnessConfig();
  const rpc = "http://127.0.0.1:" + config.chainPort;
  const cosmicUrl = "http://localhost:" + config.webPort;
  const logs = join(config.runDir, "logs");
  const services: ManagedProcess[] = [];
  const serve = (name: string, command: string, args: string[], cwd: string, env = {}) => {
    const proc = spawnSupervised({
      name,
      command,
      args,
      cwd,
      env,
      logFile: join(logs, name + ".log"),
    });
    services.push(proc);
    return proc;
  };
  const run = (name: string, command: string, args: string[], cwd: string, env = {}) =>
    runBlocking({ name, command, args, cwd, env, logFile: join(logs, name + ".log") });
  const ready = (proc: ManagedProcess, check: () => Promise<boolean>, timeoutMs = 120_000) =>
    waitFor(
      proc.name,
      async () => {
        if (!isProcessAlive(proc.pid))
          throw new WaitAbortedError(proc.name + " exited; see " + proc.logFile);
        return check();
      },
      { timeoutMs, intervalMs: 500 },
    );
  for (const port of [
    config.chainPort,
    config.dbPort,
    config.webPort,
    config.apiPort,
    config.controlPort,
  ]) {
    await new Promise<void>((resolve, reject) => {
      const socket = createServer();
      socket.once("error", reject).listen(port, "127.0.0.1", () => socket.close(() => resolve()));
    });
  }
  let databaseStarted = false;
  let cleanup: Promise<void> | undefined;
  const stop = () =>
    (cleanup ??= (async () => {
      await Promise.all(services.map((proc) => stopProcessGroup(proc.pid)));
      if (databaseStarted) await stopDatabase(config, true);
    })());
  const interrupt = () => {
    void stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await ensureDockerUp();
    const hh = join(config.contractsDir, "node_modules/hardhat/internal/cli/cli.js");
    await run("compile", process.execPath, [hh, "compile"], config.contractsDir);
    const node = serve(
      "chain",
      process.execPath,
      [hh, "node", "--hostname", "127.0.0.1", "--port", String(config.chainPort)],
      config.contractsDir,
    );
    await ready(node, async () => (await jsonRpc(rpc, "eth_chainId")) === "0x7a69");
    await run(
      "seed",
      process.execPath,
      [join(process.env.CHAOS_ZERO_ROOT!, "verification/playground/seed.cjs")],
      config.contractsDir,
      { HARDHAT_NETWORK: "hardhat_on_localhost" },
    );
    const manifest = JSON.parse(readFileSync(process.env.V4_PLAYGROUND_MANIFEST!, "utf8"));
    const addresses = readDeployReport(config);
    if (
      manifest.cosmicUrl !== cosmicUrl ||
      manifest.rpcUrl !== rpc ||
      manifest.game !== addresses.cosmicGame
    )
      throw new Error("The game and indexer refer to different deployments");
    await jsonRpc(rpc, "evm_setIntervalMining", [1500]);
    databaseStarted = true;
    await startDatabase(config);
    await registerContractAddresses(config, addresses);
    await primeIndexerWatermark(config);
    const bin = join(config.runDir, "bin");
    mkdirSync(bin, { recursive: true });
    await run(
      "build-backend",
      "go",
      ["build", "-o", bin + "/", "./cmd/cg-etl", "./cmd/apiserver"],
      config.backendDir,
      { CGO_ENABLED: "0" },
    );
    const backendEnv = {
      RPC_URL: rpc,
      PGSQL_USERNAME: "rwcg",
      PGSQL_PASSWORD: "rwcg",
      PGSQL_DATABASE: "rwcg",
      PGSQL_HOST: "localhost:" + config.dbPort,
      LOG_FORMAT: "text",
      LOG_LEVEL: "info",
    };
    serve("indexer", join(bin, "cg-etl"), [], config.backendDir, backendEnv);
    const api = serve("api", join(bin, "apiserver"), [], config.backendDir, {
      ...backendEnv,
      HTTP_PORT: String(config.apiPort),
      ADMIN_API_KEY: "cosmic-harness-local",
    });
    await ready(api, async () => {
      const dashboard = await httpJson<{ ContractAddrs?: { CosmicGameAddr?: string } }>(
        dashboardUrl(config),
      );
      return dashboard.ContractAddrs?.CosmicGameAddr?.toLowerCase() === manifest.game.toLowerCase();
    });
    const dir = serve(
      "director",
      join(config.frontendDir, "node_modules/.bin/tsx"),
      ["scripts/harness/cli.ts", "director", "--scenario", "quiet"],
      config.frontendDir,
    );
    await ready(
      dir,
      async () =>
        (await httpJson<{ ready: boolean }>("http://127.0.0.1:" + config.controlPort + "/status"))
          .ready,
    );
    const web = serve(
      "web",
      process.execPath,
      [
        join(config.frontendDir, "node_modules/next/dist/bin/next"),
        "dev",
        "-H",
        "localhost",
        "-p",
        String(config.webPort),
      ],
      config.frontendDir,
      { ...testingModeEnv(config), NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION: "4" },
    );
    await ready(
      web,
      async () => (await fetch(cosmicUrl + "/experimental-ui", { redirect: "error" })).ok,
    );
    await run(
      "playwright",
      process.execPath,
      [
        join(config.frontendDir, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config=e2e/v4-playground/playwright.config.ts",
        ...process.argv.slice(2),
      ],
      config.frontendDir,
    );
  } finally {
    await stop();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
