import { readSecondsUntilFinalization } from '../director/abiCalls';
import type { World } from '../director/world';

describe('readSecondsUntilFinalization', () => {
  it.each([
    [12n, 12n],
    [0n, 0n],
    [-103n, 0n],
  ])('reports %s seconds as a countdown of %s', async (remaining, expected) => {
    const world = {
      addresses: { cosmicGame: '0x0000000000000000000000000000000000000001' },
      publicClient: { readContract: jest.fn().mockResolvedValue(remaining) },
    } as unknown as World;
    expect(await readSecondsUntilFinalization(world)).toBe(expected);
  });
});
