import fc from 'fast-check';

import { fuzzParams } from '@/test-utils/fuzz';

import { computeMaxLateGesturePrice } from '@/utils/lateBidPricing';

it('covers every mining instant on the Solidity late-price curve and exactly matches its final charge', () => {
  // Couple the window to its divisor as the contract does. Bound the inputs so
  // even the largest intermediate fits an EVM word (unchecked arithmetic).
  const config = fc.record({
    base: fc.bigInt({ min: 1n, max: 10n ** 23n }),
    increment: fc.bigInt({ min: 1_000_000n, max: 86_400_000_000n }),
    divisor: fc.bigInt({ min: 1_000_000n, max: 6_000_000n }),
    multiplier: fc.bigInt({ min: 0n, max: 32_768_000_000n }),
    exponent: fc.integer({ min: 0, max: 8 }),
    sampledFraction: fc.integer({ min: 0, max: 1000 }),
  });
  fc.assert(
    fc.property(config, ({ base, increment, divisor, multiplier, exponent, sampledFraction }) => {
      const window = increment / divisor;
      // An independently evaluated fixed-point rational, matching the EVM's
      // intermediate floor. The Solidity implementation uses exponentiation and a shift.
      function priceWhen(remaining: bigint) {
        if (remaining >= window) return base;
        const elapsed = remaining <= 0n ? window : window - remaining;
        const units = (elapsed * multiplier) / increment;
        let numerator = base,
          denominator = 1n;
        for (let i = 0; i < exponent; i++) {
          numerator *= units;
          denominator *= 8192n;
        }
        return base + numerator / denominator;
      }
      const cap = computeMaxLateGesturePrice({
        basePrice: base,
        roundLateBidDuration: window,
        premiumBaseMultiplier: multiplier,
        mainPrizeTimeIncrementInMicroSeconds: increment,
        premiumExponent: BigInt(exponent),
      });
      for (const remaining of [
        window + 1n,
        window,
        (window * BigInt(sampledFraction)) / 1000n,
        0n,
        -1n,
      ]) {
        expect(cap).toBeGreaterThanOrEqual(priceWhen(remaining));
      }
      expect(cap).toBe(priceWhen(-1n));
    }),
    fuzzParams(500),
  );
});
