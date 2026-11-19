# Three-site V4 browser test

This Playwright scenario connects Cosmic Signature, Chaos Zero and Axiom Zero to one disposable Hardhat chain. It deploys one game proxy, plays a cycle under each of V1, V2 and V3, deploys the real Chaos Zero market and auction, and upgrades the proxy to V4. The browser submits a gesture, buys a position in that cycle, then bids on an NFT registered when the cycle closes. The test checks the indexed gesture, on-chain position, registered batch and funded auction bid. Time advances on the local chain to reach finalization and auction eligibility.

The [V4 browser workflow](../../../.github/workflows/chaos-v4-playground.yml) exercises the game and three websites from one monorepo revision, with the external indexer/API from the [shared backend lock](../../../Cosmic-Signature-frontend/harness.lock.json). The local runner tests the current working tree, including edited and newly added frontend source files.

## Run locally

Run the following commands from the monorepo root. The game and websites come from the in-tree `Cosmic-Signature/`, `Cosmic-Signature-frontend/`, `ChaosZero/` and `axiomzero/` packages. Place an augur-explorer checkout alongside the monorepo or point `RWCG_BACKEND_DIR` at an existing checkout. For a clean CI-equivalent backend without switching someone’s working branch, run:

```sh
export RWCG_BACKEND_DIR="$(mktemp -d)/augur-explorer"
git clone --no-checkout https://github.com/PredictionExplorer/augur-explorer.git "$RWCG_BACKEND_DIR"
git -C "$RWCG_BACKEND_DIR" checkout --detach "$(node -p "require('./Cosmic-Signature-frontend/harness.lock.json').backend.ref")"
```

Use Node from `ChaosZero/.node-version`, pnpm from `ChaosZero/package.json`, Foundry 1.7.1, and the Go toolchain from the backend's `go.mod`. Start Docker with Compose available. Put the [Goose 3.27.2 migration CLI](https://github.com/pressly/goose/releases/tag/v3.27.2) on your PATH; the pinned backend harness uses it to apply the PostgreSQL migrations on a clean machine. The game expects a native Solidity 0.8.38 binary installed in the solc-select artifact directory. On Linux, CI downloads its checksum-verified binary; on macOS, `solc-select install 0.8.38` installs the native build. Foundry uses the Solidity version from `ChaosZero/foundry.toml`.

Install each package’s locked dependencies and Chromium once.

```sh
git submodule update --init --recursive
pnpm --dir ChaosZero install --frozen-lockfile
pnpm --dir ChaosZero/frontend install --frozen-lockfile
pnpm --dir axiomzero install --frozen-lockfile
npm --prefix Cosmic-Signature ci
npm --prefix Cosmic-Signature-frontend ci
(cd Cosmic-Signature-frontend && ./node_modules/.bin/playwright install chromium)
```

Run the browser scenario from the monorepo root.

```sh
pnpm --dir ChaosZero test:v4:browser
```

The launcher stages the Cosmic frontend's working source and installed dependencies in a disposable workspace. Local environment files and ignored build products are excluded. It compiles the game and market, builds the two Go services into the workspace, starts PostgreSQL and the three sites, and drives a funded local wallet. The console prints the workspace path. A failed run retains its logs under `.harness/logs/` and Playwright's failure output under `test-results/`. The workflow uploads those diagnostics on failure.
