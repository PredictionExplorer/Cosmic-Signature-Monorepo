import assert from "node:assert/strict";
import fc from "fast-check";
import { it } from "vitest";
import { fixedAmounts, independentPortfolioValue, type IndependentWallet } from "./models";
import { ACCOUNT } from "./test-fixtures";

// Splitting a backed pair deposits one unit of CST. Transfer only one side to Bob,
// then redeem some complete pairs. No trade or rounded quote enters the cash oracle.
// Generate disjoint pieces of a deposit so shrinking one piece preserves every bound.
const sizeLimit = 1n << 118n;
const question = fc.record({
  gift: fc.bigInt({ min: 1n, max: sizeLimit }),
  kept: fc.bigInt({ min: 0n, max: sizeLimit }),
  merge: fc.bigInt({ min: 0n, max: sizeLimit }),
  giftYes: fc.boolean(),
});

function wallet(owner: IndependentWallet["owner"], yes: bigint[], no: bigint[]): IndependentWallet {
  return {
    owner,
    yes: fixedAmounts(yes),
    no: fixedAmounts(no),
    balance: 0n,
    allowance: 0n,
  };
}

it("settled portfolio rights plus prior merges conserve every split across all 256 outcomes", () => {
  fc.assert(
    fc.property(fc.array(question, { minLength: 8, maxLength: 8 }), (rows) => {
      const merged = rows.reduce((sum, row) => sum + row.merge, 0n);
      const issued = rows.reduce((sum, row) => sum + row.gift + row.kept + row.merge, 0n);
      const retainedPairs = rows.reduce((sum, row) => sum + row.kept, 0n);
      const alice = wallet(
        ACCOUNT,
        rows.map((row) => row.kept + (row.giftYes ? 0n : row.gift)),
        rows.map((row) => row.kept + (row.giftYes ? row.gift : 0n)),
      );
      const bob = wallet(
        "0x00000000000000000000000000000000000000bb",
        rows.map((row) => (row.giftYes ? row.gift : 0n)),
        rows.map((row) => (row.giftYes ? 0n : row.gift)),
      );
      const questions = rows.map(({ kept, gift }) => ({
        pool: { collateral: 0n, yes: kept + gift, no: kept + gift, initialYesBps: 5000 },
        funded: true,
        escrowRemaining: kept + gift,
      }));
      for (let mask = 0; mask < 256; mask++) {
        const state = { questions, finalized: true, values: mask };
        const bobRights = rows.reduce((sum, row, i) => {
          const winningSideIsYes = Math.floor(mask / 2 ** i) % 2 === 1;
          return sum + (winningSideIsYes === row.giftYes ? row.gift : 0n);
        }, 0n);
        assert.deepEqual(independentPortfolioValue({ ...state, user: bob }), {
          matched: 0n,
          claimable: bobRights,
          indicative: bobRights,
        });
        const aliceRights = issued - merged - bobRights;
        assert.deepEqual(independentPortfolioValue({ ...state, user: alice }), {
          matched: retainedPairs,
          claimable: aliceRights,
          indicative: aliceRights,
        });
      }
    }),
  );
});
