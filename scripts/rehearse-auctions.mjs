import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
function start(args, options) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(args, options) {
  const child = start(args, options);
  return new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? done()
        : reject(
            Error("Auction rehearsal process exited: " + (signal ?? code)),
          ),
    );
  });
}
async function free(port) {
  const s = createServer();
  await new Promise((ok, no) =>
    s.once("error", no).listen(port, "127.0.0.1", ok),
  );
  await new Promise((ok) => s.close(ok));
}
async function stop() {
  for (const child of children) child.kill("SIGTERM");
  for (let i = 0; i < 30 && children.size; i++) await delay(100);
  for (const child of children) child.kill("SIGKILL");
}
async function main() {
  await Promise.all([free(8559), free(4599)]);
  const temp = await mkdtemp(resolve(tmpdir(), "axiom-auction-"));
  console.log("Local auction rehearsal logs:", temp);
  // A local-chain production bundle must never overwrite the regular site build.
  const site = resolve(temp, "site");
  await mkdir(site);
  await Promise.all(
    [
      "src",
      "public",
      "package.json",
      "pnpm-workspace.yaml",
      "patches",
      "pnpm-lock.yaml",
      "postcss.config.mjs",
      "next.config.ts",
      "tsconfig.json",
      "next-env.d.ts",
    ].map((entry) =>
      cp(resolve(root, entry), resolve(site, entry), { recursive: true }),
    ),
  );
  await symlink(
    resolve(root, "node_modules"),
    resolve(site, "node_modules"),
    "dir",
  );
  const contractRoot = resolve(
    process.env.COSMIC_CONTRACT_ROOT ?? resolve(root, "../Cosmic-Signature"),
  );
  const fixtureFile = resolve(temp, "fixture.json");
  const config = resolve(temp, "hardhat.config.cjs");
  await writeFile(
    config,
    [
      "const config = require(" +
        JSON.stringify(resolve(contractRoot, "hardhat.config.js")) +
        ");",
      "config.paths.root = " + JSON.stringify(contractRoot) + ";",
      "config.paths.artifacts = " +
        JSON.stringify(resolve(contractRoot, "artifacts/production")) +
        ";",
      "config.paths.cache = " +
        JSON.stringify(resolve(contractRoot, "cache/production")) +
        ";",
      "config.networks.hardhat.loggingEnabled = false;",
      'config.networks.hardhat_on_localhost={...config.networks.hardhat_on_localhost,url:"http://127.0.0.1:8559",chainId:31337,gas:30000000,initialDate:config.networks.hardhat.initialDate,timeout:30000};',
      "module.exports=config;",
    ].join("\n"),
  );
  const env = {
    ...process.env,
    TMPDIR: temp,
    COSMIC_CONTRACT_ROOT: contractRoot,
    AXIOM_AUCTION_FIXTURE: fixtureFile,
    AXIOM_AUCTION_TEST_SITE: site,
    HARDHAT_CONFIG: config,
    HARDHAT_MODE_CODE: "1",
    LONG_TEST_MODE_CODE: "1",
    ENABLE_HARDHAT_PREPROCESSOR: "false",
  };
  delete env.RUN_V4_FORK_REHEARSAL;
  const hh = resolve(contractRoot, "node_modules/hardhat/internal/cli/cli.js");
  const node = start(
    [
      hh,
      "--config",
      config,
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "8559",
    ],
    {
      cwd: contractRoot,
      env: { ...env, HARDHAT_NETWORK: "hardhat" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const log = createWriteStream(resolve(temp, "node.log"));
  node.stdout.pipe(log);
  node.stderr.pipe(log);
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (node.exitCode !== null) throw Error("Owned Hardhat node exited");
      try {
        const r = await fetch("http://127.0.0.1:8559", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(500),
        });
        ready = (await r.json()).result === "0x7a69";
      } catch {}
      if (ready) break;
      await delay(125);
    }
    assert(ready, "Owned local node did not start.");
    await run([resolve(root, "tests/auction-local/seed.mjs")], {
      cwd: contractRoot,
      env: { ...env, HARDHAT_NETWORK: "hardhat_on_localhost" },
    });
    const f = JSON.parse(await readFile(fixtureFile, "utf8"));
    await run(
      [
        resolve(root, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "tests/auction-local/playwright.config.ts",
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...env,
          NEXT_PUBLIC_AUCTION_CHAIN_ID: "31337",
          NEXT_PUBLIC_AUCTION_ADDRESS: f.auction,
          NEXT_PUBLIC_AUCTION_CODE_HASH: f.codeHash,
          NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK: String(f.deploymentBlock),
          NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS: f.game,
          NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS: f.nft,
          NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL: f.rpc,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
    );
  } finally {
    await stop();
    log.end();
    await rm(site, { recursive: true, force: true });
  }
}
for (const sig of ["SIGINT", "SIGTERM"])
  process.once(sig, () => void stop().then(() => process.exit(1)));
await main();
