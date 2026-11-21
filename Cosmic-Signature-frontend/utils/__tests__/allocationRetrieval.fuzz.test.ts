import fc from 'fast-check';
import { maxUint256 } from 'viem';

import { fuzzParams } from '@/test-utils/fuzz';

import { buildRetrievalPlan } from '@/utils/allocationRetrieval';

// Missing custody is the older API's representation for the configured wallet.
const wallets = [undefined, '0x' + 'ab'.repeat(20), '0x' + 'cd'.repeat(20)] as const;
const tokens = ['0x' + 'ef'.repeat(20), '0x' + 'aa'.repeat(20), '0x' + 'cc'.repeat(20)] as const;
const entry = fc.record({
  wallet: fc.integer({ min: 0, max: wallets.length - 1 }),
  cycle: fc.integer({ min: 1, max: 16 }),
  asset: fc.integer({ min: 0, max: tokens.length - 1 }),
  redeemedEth: fc.boolean(),
  redeemedToken: fc.boolean(),
  redeemedNft: fc.boolean(),
  eth: fc.integer({ min: 1, max: 4 }),
  units: fc.bigInt({ min: 1n, max: maxUint256 }),
  order: fc.nat(),
});
type Entry = typeof entry extends fc.Arbitrary<infer T> ? T : never;

// NFT indexes are local to a holding wallet and independent of cycle numbers.
function nftIndex(entry: Entry) {
  return 100 + entry.cycle * tokens.length + entry.asset;
}

function planFor(ledger: Entry[]) {
  // Indexer endpoints have different ordering, casing and generation of raw amount field.
  const deposits = ledger.flatMap((e) =>
    Array.from({ length: 2 }, () => ({
      WalletAddr: wallets[e.wallet],
      RoundNum: e.cycle,
      Amount: e.eth / 2,
      Claimed: e.redeemedEth,
    })),
  );
  const nfts = ledger
    .filter((e) => !e.redeemedNft)
    .map((e) => ({
      WalletAddr: wallets[e.wallet]?.toUpperCase().replace('0X', '0x'),
      RoundNum: e.cycle,
      Index: nftIndex(e),
    }))
    .reverse();
  const tokenRows = ledger.map((e) => ({
    WalletAddr: wallets[e.wallet],
    RoundNum: e.cycle,
    TokenAddr: tokens[e.asset]!,
    Claimed: e.redeemedToken,
    ...(e.wallet === 0
      ? { Amount: String(e.units) }
      : { DonateClaimDiff: String(e.units), Amount: String(e.units + 1n) }),
  }));
  return buildRetrievalPlan({ deposits, nfts, tokens: tokenRows });
}

function checkLedger(ledger: Entry[]) {
  const plan = planFor(ledger);
  const pending = ledger.filter((e) => !e.redeemedEth || !e.redeemedNft || !e.redeemedToken);
  expect(plan.isEmpty).toBe(pending.length === 0);
  expect(plan.ethAmount).toBe(ledger.reduce((sum, e) => sum + (e.redeemedEth ? 0 : e.eth), 0));
  expect(plan.walletPlans).toHaveLength(new Set(pending.map((e) => e.wallet)).size);
  for (const [index, wallet] of wallets.entries()) {
    const rows = pending
      .filter((e) => e.wallet === index)
      .sort((a, b) => a.cycle - b.cycle || a.asset - b.asset);
    const actual = plan.walletPlans.find((p) => p.walletAddr?.toLowerCase() === wallet);
    if (rows.length === 0) {
      expect(actual).toBeUndefined();
      continue;
    }
    expect(actual?.rounds).toEqual([...new Set(rows.map((e) => e.cycle))]);
    expect(actual?.ethRounds).toEqual([
      ...new Set(rows.filter((e) => !e.redeemedEth).map((e) => e.cycle)),
    ]);
    expect(actual?.nftIndexes).toEqual(rows.filter((e) => !e.redeemedNft).map(nftIndex));
    const actualClaims = actual!.tokenClaims.map((t) => [
      t.roundNum,
      t.tokenAddress,
      BigInt(t.amount),
    ]);
    const claims = rows
      .filter((e) => !e.redeemedToken)
      .map((e) => [e.cycle, tokens[e.asset], e.units]);
    expect(actualClaims).toHaveLength(claims.length);
    expect(actualClaims).toEqual(expect.arrayContaining(claims));
  }
}

it('retrieves only the selected custody wallet across mixed historical, current and partially redeemed allocations', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(entry, {
        selector: (e) => [e.wallet, e.cycle, e.asset].join(':'),
        maxLength: 30,
      }),
      fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
      (generated, retrievalOrder) => {
        // Guarantee that all three wallets hold the same NFT index, cycle and token.
        const shared = wallets.map((_, wallet) => ({
          wallet,
          cycle: 0,
          asset: 0,
          redeemedEth: false,
          redeemedToken: false,
          redeemedNft: false,
          eth: 1,
          units: 2n ** 200n + BigInt(wallet),
          order: 0,
        }));
        let ledger = [...shared, ...generated].sort((a, b) => a.order - b.order);
        checkLedger(ledger);
        for (const wallet of retrievalOrder) {
          ledger = ledger.map((e) =>
            e.wallet === wallet
              ? { ...e, redeemedEth: true, redeemedToken: true, redeemedNft: true }
              : e,
          );
          checkLedger(ledger);
        }
      },
    ),
    fuzzParams(150),
  );
});
