import type { Parameters } from "fast-check";

const { FUZZ_FACTOR: factor = "1", FUZZ_SEED: seed, FUZZ_PATH: path } = process.env;
if (!/^\d+$/.test(factor) || !Number.isSafeInteger(Number(factor)) || Number(factor) < 1)
  throw new Error("FUZZ_FACTOR must be a positive integer");
if (
  seed !== undefined &&
  (!/^-?\d+$/.test(seed) || Number(seed) < -(2 ** 31) || Number(seed) >= 2 ** 31)
)
  throw new Error("FUZZ_SEED must be a signed 32-bit decimal integer");
if (path !== undefined && (seed === undefined || !/^\d+(?::\d+)*$/.test(path)))
  throw new Error("FUZZ_PATH requires FUZZ_SEED and a fast-check shrink path");

export function scaleFuzzBudget(base: number) {
  const runs = base * Number(factor);
  if (!Number.isSafeInteger(runs)) throw new Error("Requested fuzz campaign is too large");
  return runs;
}

export const fuzzParameters: Parameters<unknown> = {
  numRuns: scaleFuzzBudget(100),
  ...(seed !== undefined && { seed: Number(seed) }),
  ...(path !== undefined && { path, endOnFailure: true }),
};
