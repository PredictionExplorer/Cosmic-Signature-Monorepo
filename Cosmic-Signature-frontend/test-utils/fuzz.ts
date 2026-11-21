/** fast-check reports a failing seed and shrink path. Replay them with the same Jest test name. */
export function fuzzParams(baseRuns: number) {
  const { FUZZ_SEED: seed, FUZZ_FACTOR: factor = '1', FUZZ_PATH: path } = process.env;
  const numRuns = baseRuns * Number(factor);
  if (!/^[1-9]\d*$/.test(factor) || !Number.isSafeInteger(numRuns)) {
    throw new Error('FUZZ_FACTOR must be a positive integer with a safe total case count');
  }
  if (
    seed !== undefined &&
    (!/^-?\d+$/.test(seed) || Number(seed) < -2147483648 || Number(seed) > 2147483647)
  ) {
    throw new Error('FUZZ_SEED must be a signed 32-bit decimal integer');
  }
  if (path !== undefined && (seed === undefined || !/^\d+(?::\d+)*$/.test(path))) {
    throw new Error('FUZZ_PATH requires FUZZ_SEED and a fast-check shrink path');
  }
  return {
    numRuns,
    seed: seed === undefined ? jest.getSeed() : Number(seed),
    path,
    endOnFailure: path !== undefined,
  };
}
