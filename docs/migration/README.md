# V4 repository migration

[sources.json](sources.json) records the upstream repository, branch, full commit and exact Git tree imported for each component. The import tree includes the reconciled local V4 changes. The subsequent integration commit wires the directories, Git hooks, workflows and tests together. `make verify-import` verifies the recorded snapshots using only the Git data in a full clone.

| Component | Selected work |
| --- | --- |
| Game | The published V4 implementation plus the local four-version fuzz campaign, real companion contract checks and replay/bootstrap work |
| Chaos Zero | The published V4 branch, including merged PRs 3–9, plus the local cross-site browser test and real-game support for the local market UI |
| Axiom Zero | The published V4 marketplace and English auction frontend |
| Main website | Published main plus the local V4 funding, mechanics, translation, and regression changes applied by three-way merge |

The original commit IDs identify the upstream repositories. During import, historical provider credentials were removed from earlier revisions. Some imported commits therefore have different IDs. The recorded tree checks preserve the exact selected source and local changes before monorepo-specific edits.

The `legacy/game-v3` tag preserves the historical game V3 branch for source comparison; `legacy/game-main` preserves the game repository's separate main-line snapshot at migration. Later, independently developed main-line changes were not automatically applied on top of the tested V4 contracts. For the deployed V3 bytecode and storage evidence, use the [Arbitrum V3 baseline](../../Cosmic-Signature/test/data/deployed-storage-layouts/arbitrumOne-CosmicSignatureGameV3.json).

```sh
git diff --stat legacy/game-v3:contracts/production HEAD:Cosmic-Signature/contracts/production
```

Generated local-chain state, builds, installed dependencies and machine-local environment files are recreated by the component tools. The indexer/API, artwork projects, Random Walk, Cosmic Quiz and alternative frontends are external to this repository.

For the first publication to a new remote, send the `V4` branch and the two comparison tags in the same push. After configuring the destination, the refspecs are `V4`, `refs/tags/legacy/game-v3`, and `refs/tags/legacy/game-main`. The migration check in CI uses a full checkout to verify these objects.
