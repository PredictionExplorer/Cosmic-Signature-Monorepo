// Run the component-native suites with one replayable seed. The sites keep
// independent lockfiles and can still be tested from their own directories.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sites = {
  "game-site": ["Cosmic-Signature-frontend", "npm"],
  "chaos-site": ["ChaosZero/frontend", "pnpm"],
  "axiom-site": ["axiomzero", "pnpm"],
};
const scope = process.argv[2] ?? "all";
if (
  process.argv.length > 3 ||
  ![
    "all",
    "contracts",
    "frontends",
    "integration",
    ...Object.keys(sites),
  ].includes(scope)
) {
  throw new Error(
    "Expected all, contracts, frontends, integration, game-site, chaos-site or axiom-site",
  );
}
if (process.env.FUZZ_PATH !== undefined) {
  throw new Error(
    "Replay a shrink path with just the failing property selected in its component; see docs/fuzz-testing.md",
  );
}

const input = process.env.FUZZ_SEED;
const seed = input === undefined ? randomBytes(4).readInt32BE() : Number(input);
if (
  (input !== undefined && !/^-?\d+$/.test(input)) ||
  !Number.isInteger(seed) ||
  seed < -0x80000000 ||
  seed > 0x7fffffff
) {
  throw new Error("FUZZ_SEED must be a signed 32-bit decimal integer");
}
// Hardhat parses even bare values as hex. Preserve the 32 seed bits for
// both Solidity runners, including when fast-check prints a negative seed.
const contractSeed = "0x" + (seed >>> 0).toString(16);
const factor = process.env.FUZZ_FACTOR ?? "1";
if (!/^[1-9]\d*$/.test(factor) || !Number.isSafeInteger(Number(factor))) {
  throw new Error("FUZZ_FACTOR must be a positive integer");
}
console.log(
  `Fuzz seed: ${seed} (contracts: ${contractSeed}). Replay: FUZZ_SEED=${seed} FUZZ_FACTOR=${factor} node scripts/run-fuzz.mjs ${scope}`,
);

function run(component, command, args, env) {
  console.log(`\n[${component}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: join(root, component),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.signal) console.error(`Terminated by ${result.signal}`);
    process.exit(result.status ?? 1);
  }
}

if (scope === "all" || scope === "contracts") {
  run(
    "Cosmic-Signature",
    "npx",
    [
      "--no-install",
      "hardhat",
      "test",
      "--network",
      "hardhat",
      "test/tests-src/FuzzTest.js",
    ],
    {
      FUZZ_SEED: contractSeed,
      HARDHAT_MODE_CODE: "1",
      LONG_TEST_MODE_CODE: "1",
      ENABLE_HARDHAT_PREPROCESSOR: "false",
    },
  );
  const compiler = join(
    homedir(),
    ".solc-select/artifacts/solc-0.8.38/solc-0.8.38",
  );
  run(
    "Cosmic-Signature",
    "forge",
    ["test", "--use", compiler, "--offline", "-vv"],
    { FOUNDRY_FUZZ_SEED: contractSeed },
  );
  // The package's full suite includes stateful invariants and properties
  // whose function names do not follow a single testFuzz prefix convention.
  run("ChaosZero", "forge", ["test", "-vv"], {
    FOUNDRY_FUZZ_SEED: contractSeed,
    ARBITRUM_RPC_URL: "",
    CHAOSZERO_V3_FORK_RPC_URL: "",
  });
}
for (const [name, [directory, manager]] of Object.entries(sites)) {
  if (scope === "all" || scope === "frontends" || scope === name)
    run(directory, manager, ["run", "test:fuzz"], { FUZZ_SEED: String(seed) });
}

if (scope === "integration") {
  // The full campaign has already built these production artifacts in its Hardhat step.
  run("Cosmic-Signature", "npx", ["--no-install", "hardhat", "compile"], {
    HARDHAT_MODE_CODE: "1",
    ENABLE_HARDHAT_PREPROCESSOR: "false",
  });
}
if (scope === "all" || scope === "integration") {
  run(
    "axiomzero",
    "pnpm",
    ["run", "test:auction:local", "--grep", "@contract-quote"],
    { FUZZ_SEED: String(seed), AXIOM_AUCTION_QUOTES_ONLY: "1" },
  );
}
