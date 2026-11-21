# Contributing to Cosmic Signature

Start in the component that owns the behavior. The [architecture guide](docs/architecture.md) maps contract code, websites, test fixtures and the external indexer. Read that component’s README and local agent or contributor guide before editing it.

## Set up a checkout

Use a full clone on the V4 branch. Select the Node version in [.node-version](.node-version) and install pnpm 10.32.0. Run `make setup` from the root to initialize the pinned Solidity submodules and install the five dependency trees from their lockfiles. Run `make hooks` to enable component-aware Git hooks in this checkout.

For contract work, install Foundry 1.7.1 and native solc 0.8.38 for the game. The game expects the solc-select artifact layout. On macOS use `solc-select install 0.8.38`. On Linux x86-64 use the [checksum-pinned CI installer](scripts/ci/install-game-solc.sh). Foundry selects the Chaos Zero compiler from its [configuration](ChaosZero/foundry.toml). For edits limited to one component, its README has a smaller setup.

## Choose a test

Run these targets from the root. A cross-component change can need more than one row.

| What changed | First check | What it exercises |
| --- | --- | --- |
| Generated inputs, sequences of actions, or economic invariants | `make test-fuzz` | Use the [fuzz guide](docs/fuzz-testing.md) to select one layer, scale case counts and replay a minimized failure. |
| Shared scripts, Git hooks, contributor documentation | `make test-repo` | Tooling regressions, relative link paths in root guides and import history. Requires Python 3, Node and a full Git clone with tags. |
| Game contracts, storage or NFTs | `make test-game` | Hardhat regression suite across compiler modes, V1–V4 proxy upgrades, task credential handling and Foundry auction invariants. |
| Main game website | `make test-site` | Locale and terminology gates, lint, types and Jest coverage thresholds. The [site workflow](.github/workflows/game-site.yml) also checks the production build and browser flows. |
| Chaos Zero contracts or website | `make test-chaos` | Market behavior, accounting and website checks. Install its Chromium build once with `(cd ChaosZero && pnpm test:e2e:install)`. See the [Chaos Zero contributor guide](ChaosZero/CONTRIBUTING.md) for focused commands and the [verification tools](ChaosZero/verification/) for symbolic and static checks. |
| Axiom Zero website | `make test-axiom` | Lint, types and Vitest coverage. Use `pnpm test:fuzz` inside `axiomzero/` for the property suites. |
| Interaction between game and auction | `make test-auction` | Production game artifacts on a disposable local chain with two wallets in Chromium. Install the browser once with `(cd axiomzero && pnpm exec playwright install chromium)`. |
| Human wallets, bots, local controls or fast-cycle seeding | `make test-play` | Drives two browser wallets, verifies market and auction accounting, exercises bots, advances time and stops an isolated interactive session. See the [local playground guide](docs/local-playground.md). |
| A workflow spanning the game, markets and websites | `make test-playground` | Three websites, the real local indexer/API and a single upgraded game proxy. Follow the [playground setup](ChaosZero/verification/playground/README.md) for Docker, Go, Goose, Chromium and the pinned backend checkout. |

`make test` runs the repository checks and four component suites. `make test-v4` runs the game suite and both local-chain browser rehearsals. GitHub also runs dedicated checks for concerns such as workflow security, accessibility and production bytecode. See the [workflow definitions](.github/workflows/) for exact commands and triggers.

## Change and review

- Put a regression test next to the suite that exercises the failure. For shared contract changes, check the upgrade from existing state as well as the fresh deployment. Update downstream ABI consumers, fixtures and docs in the same change.
- To replay the game’s stateful campaign, record the commit, seed and compiler profile from the failing run. Use the [four-version campaign instructions](Cosmic-Signature/docs/v4-art-auction-upgrade.md#four-version-stateful-campaign). For a Foundry property, run `forge test --match-test TEST_NAME --fuzz-seed SEED` from the component that owns it.
- Keep lockfile changes in their owning package and use its pinned package manager. Keep local chain state, personal environment files and generated build output out of Git.
- Target V4 with a focused pull request. Describe the behavior affected, the checks you ran and any checks that need an external service. The browser jobs retain failure diagnostics. Report suspected vulnerabilities through the [security policy](SECURITY.md).
