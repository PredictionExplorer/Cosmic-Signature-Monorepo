import type fc from "fast-check";

/** fast-check prints both seed and shrink path. Replay a path with one test selected. */
export function fuzzParams<T>(baseRuns: number): fc.Parameters<T> {
  const {
    FUZZ_SEED: seed,
    FUZZ_PATH: path,
    FUZZ_FACTOR: factor,
    FUZZ_TIME_SECONDS: seconds,
  } = process.env;
  const replay: fc.Parameters<T> = {};
  if (seed !== undefined) {
    const parsed = Number(seed);
    if (!/^-?\d+$/.test(seed) || parsed < -0x80000000 || parsed > 0x7fffffff)
      throw new Error("FUZZ_SEED must be a signed 32-bit decimal integer");
    replay.seed = parsed;
  }
  if (path !== undefined) {
    if (seed === undefined || !/^\d+(?::\d+)*$/.test(path))
      throw new Error("FUZZ_PATH requires a seed and a fast-check shrink path");
    replay.path = path;
    replay.endOnFailure = true;
  }
  if (seconds !== undefined) {
    const timeLimit = Number(seconds) * 1000;
    if (!Number.isFinite(timeLimit) || timeLimit <= 0)
      throw new Error("FUZZ_TIME_SECONDS must be positive");
    return {
      ...replay,
      numRuns: Number.MAX_SAFE_INTEGER,
      interruptAfterTimeLimit: timeLimit,
      markInterruptAsFailure: false,
    };
  }
  const numRuns = Math.ceil(baseRuns * Number(factor ?? 1));
  if (!Number.isSafeInteger(numRuns) || numRuns < 1)
    throw new Error("FUZZ_FACTOR must produce a positive, finite case count");
  return { ...replay, numRuns };
}
