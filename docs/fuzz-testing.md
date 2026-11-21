# Fuzz testing V4

Run `make test-fuzz` from a checkout with the [development toolchain](../CONTRIBUTING.md) installed. This plays across all four game implementations on an in-process Hardhat network, runs both Foundry suites, then runs the three frontends’ property campaigns and the local frontend-to-auction differential test. It does not need a wallet, a running playground, or a public RPC. Archive-fork scenarios are separate opt-in runs with their own RPC endpoints.

For a smaller change, use `make test-fuzz-contracts`, `make test-fuzz-frontends` or `make test-fuzz-integration`. Run a single frontend with `node scripts/run-fuzz.mjs game-site`, `chaos-site` or `axiom-site`. Each invocation prints its seed before executing tests. These examples repeat the full campaign or scale the frontend campaign.

```sh
FUZZ_SEED=17019 make test-fuzz
FUZZ_SEED=-17395811 FUZZ_FACTOR=10 make test-fuzz-frontends
```

The shared entry point accepts signed 32-bit decimal seeds. It converts the same bits to hexadecimal for Foundry and Hardhat. This matters because the native game runner interprets even bare seeds as hexadecimal. `FUZZ_FACTOR` scales frontend and real-auction differential case counts. Foundry uses its native run and depth settings.

## What the properties check

| Boundary | Independent expectation | Tests |
| --- | --- | --- |
| V1 through V4 on one proxy | Historical game state, token rights and companion contracts survive upgrades; earlier claims can still be exercised after later funding and auction registration. | [Four-version stateful campaign](../Cosmic-Signature/docs/v4-art-auction-upgrade.md#four-version-stateful-campaign) |
| Auction custody and refunds | An independent model tracks each lot, wallet credit, ETH liability and NFT owner through bids, self-raises, outbids, settlement, withdrawal and delivery. Each sequence finishes by exercising outstanding claims. | [Auction Foundry suite](../Cosmic-Signature/test/foundry/ArtAuctionFuzz.t.sol) |
| Chaos Zero game-funded markets | Bulk merges, winning and losing position transfers, and claims before/after settlement conserve each question’s backing and each holder’s entitlement as later 8,000 CST grants arrive. | [Claim-backing properties](../ChaosZero/test/GameFundedClaimBacking.t.sol) |
| Main site amounts, pricing and retrieval | Exact token units across every supported locale and the uint256 boundary; late-gesture price caps against independent integer arithmetic; retrievals grouped by the correct historical wallet. | [Amount properties](../Cosmic-Signature-frontend/components/tokens/transfer/__tests__/amount.fuzz.test.ts), [pricing](../Cosmic-Signature-frontend/utils/__tests__/lateBidPricing.fuzz.test.ts) and [retrievals](../Cosmic-Signature-frontend/utils/__tests__/allocationRetrieval.fuzz.test.ts) |
| Chaos Zero web | An independent per-question payout calculation checks portfolios under all 256 terminal outcomes. Existing suites exercise pricing math, chart and event behavior, and lifecycle states. | [Portfolio properties](../ChaosZero/frontend/src/independent/portfolio.fuzz.test.ts) and [Solidity differential fixtures](../ChaosZero/CONTRIBUTING.md) |
| Axiom Zero web | Real bid-form interactions require a new review after changes of account, lot or price. Paged open-lot results agree with a full linear scan at the same block, including eligibility and closing boundaries. Other properties cover exact wei funding, data schemas, search and history. | [Bid review](../axiomzero/tests/unit/bid-review.fuzz.test.tsx), [catalogue oracle](../axiomzero/tests/unit/open-catalogue.fuzz.test.ts) and [funding](../axiomzero/tests/unit/auction-funding.fuzz.test.ts) |

The [auction differential test](../axiomzero/tests/auction-local/lifecycle.spec.ts) generates two-wallet bidding sequences on multiple lots, compares frontend calculations to real contract state, and restores a private snapshot between examples and shrink attempts. The focused integration target runs the production quote functions on the same disposable node fixture as `make test-auction`, without starting a website. The full auction rehearsal also drives Chromium.

## Replay and triage

1. Record the failing commit, tool versions, runner, test name, seed and settings. Hardhat also prints the compiler/preprocessor flags, which affect its trace. Use the same lockfiles and compiler.
2. For a fast-check failure, copy the signed seed and the complete shrink path from its report. Select **one test** in its component. This command replays the minimized bid-review case recorded during development.

   ```sh
   cd axiomzero
   FUZZ_SEED=17019 FUZZ_PATH=0:0:0:0:2:0:5:4 pnpm exec vitest run tests/unit/bid-review.fuzz.test.tsx -t 'requires a fresh bid review'
   ```

   Use `npm run test:fuzz -- -t 'full property name'` from the main site or `pnpm exec vitest run path/to/suite -t 'full property name'` from the Chaos frontend. Preserve the original case count if replaying a failure by seed alone. Changing the generator, examples, or fast-check version can change the meaning of a shrink path.
3. For Foundry, copy the minimized calls and failure files from the job. Run `forge test --match-test TEST_NAME --fuzz-seed SEED -vvvv` in the owning directory with the original profile and depth. Use the original auction compiler path and `--offline` for CI-equivalent game builds. Re-run the recorded seed and at least one different seed after the fix.
4. Pin the smallest meaningful case as an ordinary regression test, and keep the broader property. Check that generated paths actually move funds or exercise the decision under test. A conservation check should distinguish which wallet owns a claim even when total liabilities are unchanged. The frameworks document exact replay and end-of-sequence hooks in their [fast-check parameters](https://fast-check.dev/docs/api/interfaces/Parameters/) and [Foundry invariant guide](https://www.getfoundry.sh/guides/invariant-testing).

## CI coverage

Component pull-request checks run the frontend properties at a fixed seed as part of their full unit suites. The [standalone frontend and integration workflow](../.github/workflows/frontend-fuzz.yml) checks each entry point independently on wiring changes and accepts a manual seed.

The [nightly V4 workflow](../.github/workflows/nightly-fuzz.yml) requests a daily start at **07:13 UTC** on the default branch. It runs one Linux runner for at least **180 minutes of successful fuzz passes**. Each pass uses a fresh signed 32-bit seed across the upgrade sequence, both Foundry suites, all three frontend suites and the real-auction differential test. A full pass uses 10× frontend case counts, 4,096 Foundry fuzz cases per property, and 128 invariant sequences of depth 128. The runner completes its last pass before declaring success. A failed test stops the campaign immediately. Installation, initial compilation, queuing and artifact upload are outside the measured budget. Each timed pass includes the fixture setup, test process startup and teardown required for those generated cases. The hosted job has a 270-minute safety limit. Scheduled runs have a separate concurrency group from manual and PR runs. GitHub may delay or drop a scheduled event under load and disables schedules on public repositories after 60 days of inactivity. [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

On GitHub, use **Actions → Nightly V4 fuzz campaign → Run workflow** on V4. Select `smoke` for one short pass or `full` for the same three-hour budget as the schedule. The Actions job summary reports the measured minutes. Its `nightly-fuzz-evidence` artifact contains `campaign.json` with the commit, profile, seed, duration and outcome per pass, plus `last-pass.log` with the full native output of the last or failing pass. Failed jobs retain the evidence and any Foundry counterexamples for 30 days. Successful jobs retain the evidence for 14 days. Replay a particular pass by setting the profile variables from the report and running `FUZZ_SEED=<recorded-seed> make test-fuzz`.

The [game workflow](../.github/workflows/game-v4-art-auction.yml) keeps fixed PR regression seeds, runs the longer upgrade campaign on its schedule, and varies the auction Foundry seed on longer runs. Failed auction jobs retain the effective seed, settings and Foundry counterexample files. The [Chaos Zero nightly campaign](../.github/workflows/chaos-heavy-fuzz.yml) uses the existing heavy Foundry profile and preserves its seed and minimized sequences.

The [real-chain auction](../axiomzero/tests/auction-local/) and [three-site browser rehearsal](../ChaosZero/verification/playground/README.md) cover wallet providers, the indexer and actual contract execution. Run them as well when changing a transaction boundary. Property campaigns use controlled inputs; a passing run is evidence about the properties and cases exercised.
