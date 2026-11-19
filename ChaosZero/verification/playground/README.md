# Three-site V4 browser test

This Playwright scenario connects Cosmic Signature, Chaos Zero and Axiom Zero to one disposable Hardhat chain. It deploys one game proxy, plays a cycle under each of V1, V2 and V3, deploys the real Chaos Zero market and auction, and upgrades the proxy to V4. The browser submits a gesture, buys a position in that cycle, then bids on an NFT registered when the cycle closes. The test checks the indexed gesture, on-chain position, registered batch and funded auction bid. Time advances on the local chain to reach finalization and auction eligibility.

The [V4 browser workflow](../../.github/workflows/v4-playground.yml) runs on pull requests targeting V4, pushes to V4 and manual dispatch. Its checkout steps pin the four companion repositories by full commit ID. Updating a pin means exercising that repository's actual contracts, site or backend in the next run.

## Run locally

Place the following checkouts alongside `ChaosZero/`, using the revisions in the workflow to reproduce CI.

| Directory              | Component                                     | Path override          |
| ---------------------- | --------------------------------------------- | ---------------------- |
| `Cosmic-Signature/`    | Game contracts and historical upgrade helpers | `COSMIC_CONTRACTS_DIR` |
| `cosmicgame-frontend/` | Cosmic site, browser dependencies and harness | `COSMIC_FRONTEND_ROOT` |
| `axiomzero/`           | Auction site                                  | `AXIOM_ZERO_ROOT`      |
| `augur-explorer/`      | Indexer, API and database migrations          | `RWCG_BACKEND_DIR`     |

Use Node from `.node-version`, pnpm from `package.json`, Foundry 1.7.1, and the Go toolchain from the backend's `go.mod`. Start Docker with Compose available. Put the [Goose 3.27.2 migration CLI](https://github.com/pressly/goose/releases/tag/v3.27.2) on your PATH; the pinned backend harness uses it to apply the PostgreSQL migrations on a clean machine. The game expects a native Solidity 0.8.38 binary installed in the solc-select artifact directory. On Linux, CI downloads its checksum-verified binary; on macOS, `solc-select install 0.8.38` installs the native build. Foundry uses the Solidity version from this repository's `foundry.toml`.

To reproduce CI independently of any working branches, run this once from the Chaos Zero checkout. Each fetch goes into a new, detached repository. The pinned Cosmic frontend has Next.js 16.4.6 in its lockfile.

```sh
sources=$(mktemp -d)
get_source() {
  git init -q "$sources/$1" &&
    git -C "$sources/$1" fetch -q --depth=1 "https://github.com/PredictionExplorer/$1.git" "$2" &&
    git -C "$sources/$1" checkout -q --detach FETCH_HEAD
}
get_source Cosmic-Signature 7e4f483d67f2ba5d8a99cd03a9da2491c0e5c545
get_source cosmicgame-frontend 939823399093399d324a0ab283967f38c4289832
get_source axiomzero 054c47d804267a3bd73436037e619a92a6fddaa3
get_source augur-explorer 5bbc83eb31c88de36c25a83dc1b5fe9bea36a464

export COSMIC_CONTRACTS_DIR="$sources/Cosmic-Signature"
export COSMIC_FRONTEND_ROOT="$sources/cosmicgame-frontend"
export AXIOM_ZERO_ROOT="$sources/axiomzero"
export RWCG_BACKEND_DIR="$sources/augur-explorer"
```

Install the locked dependencies and run the test from Chaos Zero. The following commands also work with already-installed sibling checkouts when the overrides are unset.

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
pnpm --dir "${AXIOM_ZERO_ROOT:-../axiomzero}" install --frozen-lockfile
npm --prefix "${COSMIC_CONTRACTS_DIR:-../Cosmic-Signature}" ci
npm --prefix "${COSMIC_FRONTEND_ROOT:-../cosmicgame-frontend}" ci
(cd "${COSMIC_FRONTEND_ROOT:-../cosmicgame-frontend}" && ./node_modules/.bin/playwright install chromium)
pnpm test:v4:browser
```

The launcher copies the committed Cosmic frontend into a temporary workspace and uses that checkout's installed dependencies. It compiles the game and market, builds the two Go services into the workspace, starts PostgreSQL and the three sites, and drives a funded local wallet. The console prints the workspace path. A failed run retains its logs under `.harness/logs/` and Playwright's failure output under `test-results/`. The workflow uploads those diagnostics on failure.
