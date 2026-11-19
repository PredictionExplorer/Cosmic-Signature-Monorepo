# Repository architecture

One game proxy serves every cycle. The three websites use different parts of the same protocol. Follow the asset or event across the boundaries below when changing a feature.

## Where code belongs

| Directory | Owns | Verification |
| --- | --- | --- |
| [Cosmic-Signature/contracts/production](../Cosmic-Signature/contracts/production/) | Versioned game implementations, storage, CST, the NFT collection and the separate English auction contract. Its interfaces define calls the game makes to companion contracts. | [Hardhat integration and upgrade tests](../Cosmic-Signature/test/tests-src/) and [Foundry auction properties](../Cosmic-Signature/test/foundry/) |
| [Cosmic-Signature-frontend](../Cosmic-Signature-frontend/) | The main site and wallet-enabled game dApp. Routes are in `app/`, protocol copy in `content/`, localized UI strings in `messages/`, and backend clients in `services/api/`. | Colocated Jest tests, [browser tests](../Cosmic-Signature-frontend/e2e/) and the [full-stack harness](../Cosmic-Signature-frontend/docs/harness.md) |
| [ChaosZero](../ChaosZero/) | The V4 game-funded eight-question market, outcome source and views live in `src/`. The website lives in `frontend/`. The original independent market also has historical holders and its own accounting. | [Foundry tests](../ChaosZero/test/), [browser tests](../ChaosZero/e2e/) and [verification tools](../ChaosZero/verification/) |
| [axiomzero](../axiomzero/) | The marketplace, including the V4 auction catalogue and bid, refund and delivery flows. The website reads the auction and prepares wallet transactions through its [auction module](../axiomzero/src/lib/auctions/). | [Unit and property tests](../axiomzero/tests/unit/), [site browser tests](../axiomzero/tests/e2e/) and [local-chain auction tests](../axiomzero/tests/auction-local/) |

Shared commands live in the root [Makefile](../Makefile), shared tooling in [scripts](../scripts/), and GitHub jobs in [.github/workflows](../.github/workflows/). Each component owns its package manifest, lockfile, build output and component-specific scripts. The [migration record](migration/README.md) explains the original names and comparison tags.

## What changes at a V4 cycle boundary

1. **Initialize the first V4 cycle.** During the inactive interval, the upgrade binds the existing game proxy to the auction and game-funded market. The initializer verifies the contract bindings and issues the first 8,000 CST grant.
2. **Close a cycle.** Existing V3 allocations still run. The game imprints eight additional NFTs into auction custody and registers the batch against the closing cycle. The batch captures its opening price. If registration fails, the close reverts.
3. **Fund the next cycle.** The game advances the cycle and records and transfers its next 8,000 CST grant. When a cycle first uses its pools, the market reads the game’s cumulative funding record and credits each grant once. The fresh grant supplies 1,000 CST per question. Grants for skipped cycles carry forward and earlier claims retain their collateral.
4. **Run auctions independently.** Axiom Zero reads each lot’s on-chain status and minimum bid. Participants sign transactions against the auction. Bidding, settlement, refunds and NFT delivery can continue after the game advances again.

The [V4 integration and storage notes](../Cosmic-Signature/docs/v4-art-auction-upgrade.md) specify timing, rounding, custody, failure behavior and the storage layout. The [Chaos Zero security model](../ChaosZero/SECURITY.md) describes the boundaries between trading collateral, game funding and older claims.

## Following a change across components

For an ABI or event change, start with the owning Solidity contract and interface. Check the readers in all three websites and the separately maintained [indexer/API](https://github.com/PredictionExplorer/augur-explorer). The main site uses indexed history alongside wallet and contract reads. Its [backend lock](../Cosmic-Signature-frontend/harness.lock.json) identifies the backend revision used in CI. The [three-site rehearsal](../ChaosZero/verification/playground/README.md) verifies the indexed gesture, market position and auction bid against one local chain.

The [contributor test matrix](../CONTRIBUTING.md) gives a local command for each boundary. The art site and renderer are maintained outside this repository.
