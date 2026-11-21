import fc from 'fast-check';

import { fuzzParams } from '@/test-utils/fuzz';

import { routing } from '@/i18n/routing';
import { formatNumber } from '@/utils/format';

import { parseTokenAmount, toPlainDecimal } from '../amount';

// The ordinary Jest viem mock approximates formatUnits with Number and loses precision.
const { formatUnits, maxUint256 } = jest.requireActual<typeof import('viem')>('viem');

const rawAmount = fc.oneof(
  fc.constantFrom(1n, 2n ** 53n + 1n, 10n ** 18n, maxUint256 - 1n, maxUint256),
  fc.bigInt({ min: 1n, max: maxUint256 }),
);
const tokenDecimals = fc.oneof(fc.constantFrom(0, 6, 8, 18, 255), fc.integer({ min: 0, max: 255 }));

describe.each(routing.locales)('wallet amount in %s', (locale) => {
  // viem provides an independent base-unit oracle. Use the display formatter's
  // decimal mark to cover the Ukrainian style override as well as Vietnamese.
  const mark = formatNumber(1.5, locale).slice(1, -1);
  const print = (amount: bigint, decimals: number) =>
    formatUnits(amount, decimals).replace('.', mark);

  it('round-trips every generated Max fill exactly and rejects a one-unit balance shortfall', () => {
    fc.assert(
      fc.property(rawAmount, tokenDecimals, (amount, decimals) => {
        const text = print(amount, decimals);
        expect(toPlainDecimal(amount, decimals, locale)).toBe(text);
        expect(parseTokenAmount(text, { locale, decimals, max: amount })).toEqual({
          wei: amount,
          error: null,
        });
        expect(parseTokenAmount(text, { locale, decimals, max: amount - 1n }).error).toBe(
          'exceedsBalance',
        );
      }),
      fuzzParams(150),
    );
  });

  it('refuses sub-unit precision and quantities outside the EVM word size even before a balance arrives', () => {
    fc.assert(
      fc.property(rawAmount, tokenDecimals, (amount, decimals) => {
        const fractionalUnit = '0' + mark + '0'.repeat(decimals) + '1';
        expect(parseTokenAmount(fractionalUnit, { locale, decimals }).error).toBe('precision');
        expect(
          parseTokenAmount(print(maxUint256 + amount, decimals), { locale, decimals }),
        ).toEqual({ wei: null, error: 'outOfRange' });
      }),
      fuzzParams(100),
    );
  });
});
