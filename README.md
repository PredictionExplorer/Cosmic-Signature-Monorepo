# Cosmic Signature

Develop the game, its main website, the Chaos Zero markets and the Axiom Zero marketplace in one Git repository. Each component retains its own build, dependency lockfiles and deployment configuration.

| Component | Contents |
| --- | --- |
| [Cosmic-Signature](Cosmic-Signature/) | Game proxy implementations V1 through V4, CST, the NFT collection, the English auction, upgrade checks and stateful fuzz tests |
| [Cosmic-Signature-frontend](Cosmic-Signature-frontend/) | Main multilingual site and game dApp, wallet flows, protocol content and local harness |
| [ChaosZero](ChaosZero/) | Eight-question game-funded market, settlement vault, web app, gas/bytecode/symbolic checks and cross-site browser test |
| [axiomzero](axiomzero/) | Marketplace site and V4 auction catalogue, bidding, refunds, results and NFT delivery |

The [indexer and API](https://github.com/PredictionExplorer/augur-explorer) are maintained separately. The browser and full-stack harnesses can run those services locally from an external checkout. The art website, renderer and other standalone products keep their existing repositories.

## Start developing

Use a full Git clone with submodules. The two Solidity libraries under `ChaosZero/lib/` are pinned third-party dependencies. Run these commands from the repository root:

```sh
git submodule update --init --recursive
make setup
make help
```

Use Node 22.23.2 and pnpm 10.32.0 for the shared test environment. The game and main site use npm. Chaos Zero and Axiom Zero use pnpm. The game requires the native Solidity 0.8.38 compiler and the market uses Foundry 1.7.1. The package READMEs cover their individual dev servers. Install shared Git hooks explicitly with `make hooks`.

## Verify V4

With the local test prerequisites installed, run `make test-v4` to exercise both the upgrade sequence and the three-site browser flow.

- `make test-game` plays on one proxy through V1, V2, V3 and V4, including the real Chaos Zero market and NFT auction. A failing seed and its profile can be replayed. [Four-version campaign](Cosmic-Signature/docs/v4-art-auction-upgrade.md#four-version-stateful-campaign)
- `make test-playground` starts the three websites on a disposable local chain and submits a game gesture, a market trade and an auction bid. For this test, install Chromium from the main site's Playwright lockfile, set up Docker and Go, and provide the external indexer checkout using `RWCG_BACKEND_DIR`. The guide identifies the supported backend revision. [Browser test setup](ChaosZero/verification/playground/README.md)
- `make test` runs the component validation suites. Individual targets are listed by `make help`. The dedicated gas, bytecode, symbolic, security and browser jobs are in [.github/workflows](.github/workflows/).

V4 issues 8,000 CST per eligible cycle, with 1,000 fresh CST per question. Each successful V4 cycle close registers eight additional NFTs in the auction. These flows share the game proxy, CST and NFT collection. The [upgrade notes](Cosmic-Signature/docs/v4-art-auction-upgrade.md) describe the inactive-cycle initializer, asset bindings, per-batch prices and public-chain release checks.

## Source history and deployment

The [migration record](docs/migration/README.md) identifies the source revision and imported Git tree of each package, including local V4 work that had yet to appear on GitHub. Inspect the original import snapshots with `make verify-import`.

For hosting, select the component's project root and network-specific configuration. Keep separate hosting projects for the main game site, Chaos Zero and Axiom Zero. Publish or upgrade contracts through the reviewed release procedure for the intended chain. Licensing and attribution remain with the respective components.
