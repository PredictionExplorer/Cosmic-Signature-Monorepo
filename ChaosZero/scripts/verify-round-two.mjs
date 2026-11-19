import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AbiCoder, getAddress, id, toQuantity } from "ethers";
import {
  HISTORY_CST,
  HISTORY_GAME,
  V3_READS,
  canonicalLogs,
  historyHash,
  publicRpcLog,
  rpcHash,
  reconstructBaseline,
  validateReceipts,
  validateWallets,
} from "./historical-baseline.mjs";
import { HISTORY_RPCS, readRpcBatch } from "./historical-rpc.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CACHE = resolve(ROOT, ".local/historical");
const OUTPUT = resolve(ROOT, "deployment/arbitrum-round-2-baseline.json");
const FIRST_BLOCK = 493_596_742n;
const FINAL_BLOCK = 511_892_555n;
const ROUND_TOPIC = `0x${2n.toString(16).padStart(64, "0")}`;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const hex = (value) => `0x${value.toString(16)}`;
async function cached(name) {
  try {
    return JSON.parse(await readFile(resolve(CACHE, name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
// Both a resumed verifier and an offline reader must see a complete JSON document.
async function writeJsonAtomically(path, value, indent) {
  const temp = await mkdtemp(join(dirname(path), ".round-two-"));
  try {
    const document = join(temp, "document.json");
    await writeFile(document, JSON.stringify(value, null, indent) + "\n", { flag: "wx" });
    await rename(document, path);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
async function cache(name, value) {
  await writeJsonAtomically(resolve(CACHE, name), value);
}

export function publicHeader(header) {
  return {
    number: toQuantity(header.number),
    hash: rpcHash(header.hash),
    timestamp: toQuantity(header.timestamp),
    stateRoot: rpcHash(header.stateRoot),
    receiptsRoot: rpcHash(header.receiptsRoot),
    parentHash: rpcHash(header.parentHash),
  };
}

export function publicReceipt(receipt) {
  if (!Array.isArray(receipt.logs) || toQuantity(receipt.status) !== "0x1")
    throw new Error("Invalid or unsuccessful transaction receipt");
  return {
    transactionHash: rpcHash(receipt.transactionHash),
    blockHash: rpcHash(receipt.blockHash),
    blockNumber: toQuantity(receipt.blockNumber),
    status: "0x1",
    logs: receipt.logs
      .filter(
        (log) =>
          getAddress(log.address) === HISTORY_GAME &&
          log.topics?.[1]?.toLowerCase() === ROUND_TOPIC,
      )
      .map(publicRpcLog),
  };
}
const call = (method, params) => ({ method, params });

async function collectLogs(refresh) {
  const existing = !refresh && (await cached("round-2-logs.json"));
  if (existing) return existing.map(publicRpcLog);
  const logs = [];
  for (let from = FIRST_BLOCK; from <= FINAL_BLOCK; from += 10_000_000n) {
    const to = from + 9_999_999n > FINAL_BLOCK ? FINAL_BLOCK : from + 9_999_999n;
    const [part] = await readRpcBatch(HISTORY_RPCS.logs, [
      call("eth_getLogs", [
        {
          address: HISTORY_GAME,
          topics: [null, ROUND_TOPIC],
          fromBlock: hex(from),
          toBlock: hex(to),
        },
      ]),
    ]);
    logs.push(...part.map(publicRpcLog));
  }
  await cache("round-2-logs.json", logs);
  return logs;
}

async function collectUpgrades(refresh) {
  const existing = !refresh && (await cached("round-2-upgrades.json"));
  if (existing) return existing.map(publicRpcLog);
  const upgrades = [];
  for (let from = FIRST_BLOCK; from <= FINAL_BLOCK; from += 10_000_000n) {
    const to = from + 9_999_999n > FINAL_BLOCK ? FINAL_BLOCK : from + 9_999_999n;
    const [part] = await readRpcBatch(HISTORY_RPCS.logs, [
      call("eth_getLogs", [
        {
          address: HISTORY_GAME,
          topics: [id("Upgraded(address)")],
          fromBlock: hex(from),
          toBlock: hex(to),
        },
      ]),
    ]);
    upgrades.push(...part.map(publicRpcLog));
  }
  await cache("round-2-upgrades.json", upgrades);
  return upgrades;
}

async function collectHeaders(logs, refresh) {
  const old = refresh ? {} : ((await cached("round-2-headers.json")) ?? {});
  const headers = Object.fromEntries(
    Object.values(old).map((raw) => {
      const header = publicHeader(raw);
      return [header.number, header];
    }),
  );
  const missing = [...new Set(logs.map((log) => log.blockNumber))].filter(
    (number) => !headers[number],
  );
  for (let index = 0; index < missing.length; index += 20) {
    const batch = missing.slice(index, index + 20);
    const received = await readRpcBatch(
      HISTORY_RPCS.headers,
      batch.map((number) => call("eth_getBlockByNumber", [number, false])),
    );
    for (const [position, number] of batch.entries()) {
      const header = received[position];
      if (BigInt(header.number) !== BigInt(number))
        throw new Error("Header request returned wrong block");
      headers[number] = publicHeader(header);
    }
    await cache("round-2-headers.json", headers);
    if (index % 100 === 0)
      console.log(
        `Checked historical headers: ${Math.min(index + 20, missing.length)}/${missing.length}`,
      );
    await delay(300);
  }
  return headers;
}

async function collectReceipts(logs, refresh) {
  const old = refresh ? [] : ((await cached("round-2-receipts.json")) ?? []);
  const byHash = new Map(
    old.map(publicReceipt).map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]),
  );
  const unique = [...new Set(logs.map((log) => log.transactionHash.toLowerCase()))];
  const missing = unique.filter((hash) => !byHash.has(hash));
  // dRPC's public plan permits at most three requests per JSON-RPC batch.
  for (let index = 0; index < missing.length; index += 3) {
    const batch = missing.slice(index, index + 3);
    const receipts = await readRpcBatch(
      HISTORY_RPCS.receipts,
      batch.map((hash) => call("eth_getTransactionReceipt", [hash])),
    );
    for (const [position, hash] of batch.entries()) {
      if (receipts[position].transactionHash.toLowerCase() !== hash)
        throw new Error("Receipt request returned wrong transaction");
      byHash.set(hash, publicReceipt(receipts[position]));
    }
    await cache("round-2-receipts.json", [...byHash.values()]);
    if (index % 100 === 0)
      console.log(
        `Checked historical receipts: ${Math.min(index + 3, missing.length)}/${missing.length}`,
      );
    await delay(300);
  }
  return unique.map((hash) => byHash.get(hash));
}

async function collectState(reconstruction) {
  const [chainId, blockNumber] = await readRpcBatch(HISTORY_RPCS.logs, [
    call("eth_chainId", []),
    call("eth_blockNumber", []),
  ]);
  if (BigInt(chainId) !== 42161n) throw new Error("Unexpected historical verification chain");
  const addresses = [...reconstruction.wallets.keys()];
  const calls = [
    call("eth_getBlockByNumber", [blockNumber, false]),
    ...["roundNum", "token", "roundStats"].map((method) =>
      call("eth_call", [
        {
          to: HISTORY_GAME,
          data: V3_READS.encodeFunctionData(method, method === "roundStats" ? [2] : []),
        },
        blockNumber,
      ]),
    ),
    call("eth_getStorageAt", [HISTORY_GAME, IMPLEMENTATION_SLOT, blockNumber]),
    ...addresses.map((address) =>
      call("eth_call", [
        { to: HISTORY_GAME, data: V3_READS.encodeFunctionData("biddersInfo", [2, address]) },
        blockNumber,
      ]),
    ),
  ];
  const [block, currentRound, token, stats, implementation, ...rawWallets] = await readRpcBatch(
    HISTORY_RPCS.logs,
    calls,
  );
  const header = publicHeader(block);
  if (header.number !== toQuantity(blockNumber))
    throw new Error("State verification returned wrong block");
  const wallets = rawWallets.map((data, index) => {
    const [ethSpent, cstBurned, lastGestureAt] = V3_READS.decodeFunctionResult("biddersInfo", data);
    return {
      address: addresses[index],
      ethSpent: ethSpent.toString(),
      cstBurned: cstBurned.toString(),
      lastGestureAt: lastGestureAt.toString(),
    };
  });
  const [nativeCount, ...newFields] = V3_READS.decodeFunctionResult("roundStats", stats);
  const result = {
    verificationBlock: BigInt(blockNumber).toString(),
    verificationBlockHash: header.hash,
    verificationTimestamp: BigInt(header.timestamp).toString(),
    gameImplementation: AbiCoder.defaultAbiCoder().decode(["address"], rpcHash(implementation))[0],
    currentRound: V3_READS.decodeFunctionResult("roundNum", currentRound)[0].toString(),
    token: V3_READS.decodeFunctionResult("token", token)[0],
    nativeCount: nativeCount.toString(),
    v3FieldsAreZero: newFields.every((value) => value === 0n),
    wallets,
  };
  if (result.token !== HISTORY_CST || BigInt(result.currentRound) <= 2n || !result.v3FieldsAreZero)
    throw new Error("Unexpected game state for the V2 historical baseline");
  await cache("round-2-state.json", result);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (
    args.some((arg) => !["--refresh", "--offline", "--write-evidence"].includes(arg)) ||
    (args.includes("--refresh") && args.includes("--offline"))
  )
    throw new Error(
      "Use --refresh, --offline, or --write-evidence; no endpoint or credential arguments are accepted",
    );
  const offline = args.includes("--offline"),
    refresh = args.includes("--refresh");
  await mkdir(CACHE, { recursive: true });
  const logs = offline ? await cached("round-2-logs.json") : await collectLogs(refresh);
  const headers = offline
    ? await cached("round-2-headers.json")
    : await collectHeaders(logs, refresh);
  const reconstruction = reconstructBaseline(logs, headers);
  const upgrades = canonicalLogs(
    offline ? await cached("round-2-upgrades.json") : await collectUpgrades(refresh),
  );
  if (upgrades.length !== 0)
    throw new Error(
      "The game implementation changed during this cycle; a single-version replay is unsafe",
    );
  const state = offline ? await cached("round-2-state.json") : await collectState(reconstruction);
  if (
    !state ||
    state.token !== HISTORY_CST ||
    BigInt(state.currentRound) <= 2n ||
    state.v3FieldsAreZero !== true ||
    reconstruction.values.gestureCount !== state.nativeCount
  )
    throw new Error("Native on-chain count cross-check missing or mismatched");
  const walletsHash = validateWallets(reconstruction, state.wallets);
  const receipts = offline
    ? await cached("round-2-receipts.json")
    : await collectReceipts(logs, refresh);
  const receiptSummary = validateReceipts(reconstruction, receipts);
  const evidence = {
    chainId: 42161,
    game: HISTORY_GAME,
    cst: HISTORY_CST,
    baselineRound: "2",
    firstMarketRound: "3",
    values: reconstruction.values,
    constructorBaselineHash: reconstruction.baselineHash,
    provenance: {
      method:
        "Fixed historical baseline reconstructed off chain; not an on-chain receipt-proof verifier",
      sourceVersion: "CosmicSignatureGameV2",
      sourceCommit: "a73aed1d5146efd600711aa4faaf4b1ae9681d49",
      gestureIndexConvention: "one-based",
      ...reconstruction.provenance,
      ...receiptSummary,
      gameUpgradeEventCount: upgrades.length,
      gameUpgradeEventsHash: historyHash(upgrades),
      walletsHash,
      verificationBlock: BigInt(state.verificationBlock).toString(),
      verificationBlockHash: rpcHash(state.verificationBlockHash),
      verificationTimestamp: BigInt(state.verificationTimestamp).toString(),
      gameImplementation: getAddress(state.gameImplementation),
      nativeCount: reconstruction.values.gestureCount,
      nativeV3FieldsAreZero: state.v3FieldsAreZero === true,
      publicRpcSources: HISTORY_RPCS,
      checks: [
        "All recorded gestures equal permanent game count",
        "Every payment and last gesture timestamp matches permanent per-wallet storage",
        "Every log block hash matches independently retrieved block header",
        "Every queried log matches an independently retrieved successful transaction receipt",
        "Replayed Endurance and Chrono wallets match closing prize events",
        "Strict record and duration ties preserve the earlier gesture",
      ],
    },
  };
  if (args.includes("--write-evidence")) {
    await mkdir(resolve(ROOT, "deployment"), { recursive: true });
    await writeJsonAtomically(OUTPUT, evidence, 2);
    console.log("Wrote deployment/arbitrum-round-2-baseline.json with public evidence only.");
  } else {
    const pinned = JSON.parse(await readFile(OUTPUT, "utf8"));
    for (const key of ["values", "constructorBaselineHash"])
      if (JSON.stringify(pinned[key]) !== JSON.stringify(evidence[key]))
        throw new Error("Reconstruction differs from reviewed baseline");
    for (const key of [
      "eventsHash",
      "headersHash",
      "walletsHash",
      "receiptEventsHash",
      "gameUpgradeEventsHash",
    ])
      if (pinned.provenance[key] !== evidence.provenance[key])
        throw new Error("Reconstruction differs from reviewed evidence commitments");
    console.log("Historical baseline and all public evidence commitments match.");
  }
  console.log(
    JSON.stringify(
      {
        values: evidence.values,
        constructorBaselineHash: evidence.constructorBaselineHash,
        provenance: {
          eventCount: evidence.provenance.eventCount,
          headerCount: evidence.provenance.headerCount,
          receiptCount: evidence.provenance.receiptCount,
          uniqueWalletCount: evidence.provenance.uniqueWalletCount,
        },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
