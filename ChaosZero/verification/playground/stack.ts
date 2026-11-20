// This file runs inside a disposable copy of the Cosmic frontend. Reuse its real
// indexer, database and wallet harness on the same chain as both market sites.
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { harnessPort } from "../../scripts/harness/ports";
import { PACES } from "../../scripts/harness/director/pace";
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
  const smoke = process.argv[2] === "--interactive-smoke";
  const interactive = smoke || process.argv[2] === "--interactive";
  const controller = new AbortController();
  const config = resolveHarnessConfig();
  const rpc = "http://127.0.0.1:" + config.chainPort;
  const cosmicUrl = "http://localhost:" + config.webPort;
  const logs = join(config.runDir, "logs");
  const services: ManagedProcess[] = [];
  const serve = (name: string, command: string, args: string[], cwd: string, env = {}) => {
    controller.signal.throwIfAborted();
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
    runBlocking({
      signal: controller.signal,
      name,
      command,
      args,
      cwd,
      env,
      logFile: join(logs, name + ".log"),
    });
  const ready = (proc: ManagedProcess, check: () => Promise<boolean>, timeoutMs = 120_000) =>
    waitFor(
      proc.name,
      async () => {
        if (controller.signal.aborted) throw new WaitAbortedError("Session interrupted");
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
    harnessPort(process.env.V4_CHAOS_PORT ?? 4671, "V4_CHAOS_PORT"),
    harnessPort(process.env.V4_AXIOM_PORT ?? 4672, "V4_AXIOM_PORT"),
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
    controller.abort();
    // Wake any pending HTTP readiness probe as well as one-shot compiler/seed steps.
    for (const proc of services) void stopProcessGroup(proc.pid);
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
      {
        HARDHAT_NETWORK: "hardhat_on_localhost",
        V4_PLAYGROUND_INTERACTIVE: interactive ? "1" : "0",
        V4_PLAYGROUND_FAST_PACE: JSON.stringify(PACES.fast),
        V4_PLAYGROUND_VERIFY_SEED: smoke ? "1" : "0",
      },
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
    await startDatabase(config, controller.signal);
    await registerContractAddresses(config, addresses);
    await primeIndexerWatermark(config);
    const bin = join(config.runDir, "bin");
    mkdirSync(bin, { recursive: true });
    const goOptions: string[] = [];
    if (interactive) {
      await run(
        "isolate-api",
        process.execPath,
        [
          join(process.env.CHAOS_ZERO_ROOT!, "verification/playground/local-backend.mjs"),
          config.backendDir,
          config.runDir,
        ],
        config.backendDir,
      );
      goOptions.push("-overlay", join(config.runDir, "backend-overlay.json"));
    }
    await run(
      "build-backend",
      "go",
      ["build", ...goOptions, "-o", bin + "/", "./cmd/cg-etl", "./cmd/apiserver"],
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
      HTTPS_HOSTNAME: "",
      HTTPS_EXTRA_LISTEN_ADDR: "",
      METRICS_ADDR: "",
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
    if (!interactive) {
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
    }
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
      {
        ...testingModeEnv(config),
        NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION: "4",
        ...(interactive && { NEXT_PUBLIC_HARNESS: "0", NEXT_PUBLIC_HARNESS_CONTROL_URL: "" }),
      },
    );
    await ready(
      web,
      async () => (await fetch(cosmicUrl + "/experimental-ui", { redirect: "error" })).ok,
    );
    if (interactive) {
      const { sites } = await import("./sites");
      await Promise.all(
        sites.map(async (site) => {
          const child = serve(
            site.kind,
            process.execPath,
            [join(config.frontendDir, "e2e/v4-playground/site.mjs"), site.kind, site.port],
            config.frontendDir,
            site.env,
          );
          await ready(
            child,
            async () => (await fetch(site.url, { redirect: "manual" })).ok,
            180_000,
          );
        }),
      );
      const { runInteractive } = await import("./interactive");
      await runInteractive(config, services, controller.signal, smoke);
      return;
    }
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
  } catch (error) {
    if (!controller.signal.aborted) throw error;
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
