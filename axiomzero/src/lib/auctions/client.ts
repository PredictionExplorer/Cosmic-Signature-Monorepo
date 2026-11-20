import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  getAbiItem,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  toHex,
  type Address,
} from "viem";
import { getArbitrumRpcTransport } from "@/lib/web3/arbitrum-transport";
import { auctionAbi } from "./abi";
import {
  auctionChain,
  auctionChainId,
  auctionRpcUrl,
  requireAuctionConfig,
} from "./config";
import { checkId, phaseOf, type AuctionLot } from "./types";

export { auctionConfigured, auctionAddress, auctionChainId } from "./config";
export { phaseOf, type AuctionLot } from "./types";

const nftAbi = parseAbi(["function getNftSeed(uint256) view returns(uint256)"]);
const client = createPublicClient({
  chain: auctionChain,
  ccipRead: false,
  transport:
    auctionChainId === 31337
      ? http(auctionRpcUrl, { batch: true, timeout: 8000, retryCount: 1 })
      : getArbitrumRpcTransport({ batch: true, timeout: 8000, retryCount: 1 }),
});

export function assertFresh(blockTime: bigint) {
  // Rehearsals explicitly advance local virtual time, independently of the browser clock.
  if (auctionChainId === 31337) return;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (blockTime < now - 120n || blockTime > now + 30n) {
    throw new Error("Auction data is stale. Refresh before signing.");
  }
}

export async function verifiedSnapshot() {
  const deployment = requireAuctionConfig();
  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const blockNumber = block.number;
  if (chainId !== auctionChainId || blockNumber < deployment.deploymentBlock)
    throw new Error("Unexpected auction network.");
  assertFresh(block.timestamp);
  const base = {
    address: deployment.address,
    abi: auctionAbi,
    blockNumber,
  } as const;
  const [code, game, nft] = await Promise.all([
    client.getCode({ address: deployment.address, blockNumber }),
    client.readContract({ ...base, functionName: "game" }),
    client.readContract({ ...base, functionName: "nft" }),
  ]);
  // Previously registered lots remain redeemable if a future game version selects another venue.
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== deployment.hash.toLowerCase() ||
    !isAddressEqual(game, deployment.game) ||
    !isAddressEqual(nft, deployment.nft)
  ) {
    throw new Error(
      "The auction deployment does not match its verified code and collection.",
    );
  }
  return {
    client,
    base,
    nft,
    blockNumber,
    blockTime: block.timestamp,
    deploymentBlock: deployment.deploymentBlock,
  };
}

type Snapshot = Awaited<ReturnType<typeof verifiedSnapshot>>;
const stamp = ({ blockNumber, blockTime }: Snapshot) => ({
  blockNumber,
  blockTime,
});
function minimum(snapshot: Snapshot, id: bigint) {
  return client.readContract({
    ...snapshot.base,
    functionName: "minimumNextBid",
    args: [id],
  });
}
function openingPrice(snapshot: Snapshot, round: bigint) {
  return client.readContract({
    ...snapshot.base,
    functionName: "openingBidByRound",
    args: [round],
  });
}
async function artworkSeed(snapshot: Snapshot, id: bigint) {
  const seed = await client.readContract({
    address: snapshot.nft,
    abi: nftAbi,
    blockNumber: snapshot.blockNumber,
    functionName: "getNftSeed",
    args: [id],
  });
  return toHex(seed, { size: 32 });
}
function readRecord(snapshot: Snapshot, id: bigint) {
  return client.readContract({
    ...snapshot.base,
    functionName: "getAuction",
    args: [id],
  });
}
export function isUnknownAuction(error: unknown, id: bigint) {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk(
    (cause) => cause instanceof ContractFunctionRevertedError,
  );
  return (
    revert instanceof ContractFunctionRevertedError &&
    revert.data?.errorName === "UnknownAuction" &&
    revert.data.args?.[0] === id
  );
}

export async function readLot(tokenId: number) {
  checkId(tokenId);
  const snapshot = await verifiedSnapshot();
  const id = BigInt(tokenId);
  let record: Awaited<ReturnType<typeof readRecord>>;
  try {
    record = await readRecord(snapshot, id);
  } catch (error) {
    if (isUnknownAuction(error, id)) return null;
    throw error;
  }
  const [openingBid, minimumNextBid, seed] = await Promise.all([
    openingPrice(snapshot, record.roundNum),
    minimum(snapshot, id),
    artworkSeed(snapshot, id),
  ]);
  return {
    lot: {
      ...record,
      tokenId,
      openingBid,
      minimumNextBid,
      seed,
    } satisfies AuctionLot,
    ...stamp(snapshot),
  };
}

async function firstInBatch(snapshot: Snapshot, index: bigint) {
  const first = await client.readContract({
    ...snapshot.base,
    functionName: "firstNftIdByBatchIndex",
    args: [index],
  });
  if (first > BigInt(Number.MAX_SAFE_INTEGER) - 7n)
    throw new RangeError("Token ID exceeds the catalogue range.");
  return first;
}

type LotRecord = Awaited<ReturnType<typeof readRecord>>;

async function lotsInBatch(
  snapshot: Snapshot,
  first: bigint,
  onlyOpen: boolean,
  firstRecord?: LotRecord,
): Promise<AuctionLot[]> {
  const records = await Promise.all(
    Array.from({ length: 8 }, async (_, offset) => {
      const id = first + BigInt(offset);
      const record =
        offset === 0 && firstRecord
          ? firstRecord
          : await readRecord(snapshot, id);
      return { id, record };
    }),
  );
  const rows = onlyOpen
    ? records.filter(({ record }) => {
        const phase = phaseOf(record, snapshot.blockTime);
        return phase === "waiting" || phase === "active";
      })
    : records;
  if (!rows.length) return [];
  const [openingBid, details] = await Promise.all([
    openingPrice(snapshot, rows[0].record.roundNum),
    Promise.all(
      rows.map(async ({ id, record }) => {
        const [minimumNextBid, seed] = await Promise.all([
          minimum(snapshot, id),
          artworkSeed(snapshot, id),
        ]);
        return { ...record, tokenId: Number(id), minimumNextBid, seed };
      }),
    ),
  ]);
  return details.map((row) => ({ ...row, openingBid }));
}

const batchCount = (snapshot: Snapshot) =>
  client.readContract({
    ...snapshot.base,
    functionName: "registeredBatchCount",
  });

async function readBatchAt(snapshot: Snapshot, page: number) {
  const count = await batchCount(snapshot);
  const index = count - 1n - BigInt(page);
  const lots =
    index < 0n
      ? []
      : await lotsInBatch(snapshot, await firstInBatch(snapshot, index), false);
  return { count, lots, ...stamp(snapshot) };
}

// A batch receives one immutable eligibleAt when appended. Skip any number
// of previews in O(log count); bid/settlement states within a batch vary.
export async function readOpenLots(before?: number) {
  if (before !== undefined) checkId(before);
  const snapshot = await verifiedSnapshot();
  const count = await batchCount(snapshot);
  const limit = before === undefined ? count : BigInt(before);
  const base = {
    count,
    lots: [] as AuctionLot[],
    nextBefore: null as bigint | null,
    firstOpening: null as bigint | null,
    ...stamp(snapshot),
  };
  if (limit === 0n || limit > count) return base;
  const headers = new Map<bigint, { first: bigint; record: LotRecord }>();
  async function header(index: bigint) {
    const known = headers.get(index);
    if (known) return known;
    const first = await firstInBatch(snapshot, index);
    const result = { first, record: await readRecord(snapshot, first) };
    headers.set(index, result);
    return result;
  }
  let end = limit;
  if ((await header(limit - 1n)).record.eligibleAt > snapshot.blockTime) {
    let start = 0n;
    end = limit - 1n;
    while (start < end) {
      const mid = (start + end) / 2n;
      if ((await header(mid)).record.eligibleAt <= snapshot.blockTime)
        start = mid + 1n;
      else end = mid;
    }
  }
  if (!end)
    return { ...base, firstOpening: (await header(0n)).record.eligibleAt };
  // Keep RPC work per page bounded even when years of lots have sold.
  // The stable exclusive cursor always continues with the next unexamined batch.
  const floor = end > 4n ? end - 4n : 0n;
  while (end > floor) {
    end -= 1n;
    const index = end;
    const { first, record } = await header(index);
    const lots = await lotsInBatch(snapshot, first, true, record);
    if (lots.length) return { ...base, lots, nextBefore: index || null };
  }
  return { ...base, nextBefore: floor || null };
}

export async function readBatch(page = 0) {
  checkId(page);
  return readBatchAt(await verifiedSnapshot(), page);
}

export async function readWalletActivity(account: Address, page = 0) {
  checkId(page);
  const snapshot = await verifiedSnapshot();
  const [batch, refund] = await Promise.all([
    readBatchAt(snapshot, page),
    client.readContract({
      ...snapshot.base,
      functionName: "refundCredits",
      args: [account],
    }),
  ]);
  const held = batch.lots.filter(
    (lot) => lot.highestBid > 0n && isAddressEqual(lot.highestBidder, account),
  );
  return {
    count: batch.count,
    refund,
    leading: held.filter(
      (lot) => lot.endAt > snapshot.blockTime && !lot.settled,
    ),
    won: held.filter((lot) => lot.endAt <= snapshot.blockTime || lot.settled),
    ...stamp(snapshot),
  };
}

// Each page has a concrete continuation, even if that entire span contained no events.
// Some RPCs impose smaller log windows. Narrow a rejected range, never skip unread blocks.
export async function eventPage<T>(
  floor: bigint,
  head: bigint,
  before: bigint | undefined,
  read: (from: bigint, to: bigint) => Promise<T[]>,
) {
  if (before !== undefined && before < 0n)
    throw new RangeError("Invalid auction history cursor.");
  const to = before !== undefined && before < head ? before : head;
  if (to < floor) return { rows: [] as T[], nextBeforeBlock: null };
  let span = 1_000_000n;
  for (;;) {
    const from = to - floor < span ? floor : to - span + 1n;
    try {
      const rows = await read(from, to);
      return { rows, nextBeforeBlock: from === floor ? null : from - 1n };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        to === from ||
        !/block range|range.{0,40}(large|limit|exceed)|too many|too (?:large|wide)|limit.{0,20}(range|blocks|results)|more than.{0,30}results|response size|-32005/i.test(
          message,
        )
      )
        throw error;
      span = (to - from + 1n) / 2n;
    }
  }
}

const bidEvent = getAbiItem({ abi: auctionAbi, name: "AuctionBidPlaced" });
const saleEvent = getAbiItem({ abi: auctionAbi, name: "AuctionSettled" });
function newest<T extends { blockNumber: bigint; logIndex: number }>(
  a: T,
  b: T,
) {
  if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
  return a.blockNumber > b.blockNumber ? -1 : 1;
}

export async function readBidHistory(tokenId: number, beforeBlock?: bigint) {
  checkId(tokenId);
  const snapshot = await verifiedSnapshot();
  const { rows, nextBeforeBlock } = await eventPage(
    snapshot.deploymentBlock,
    snapshot.blockNumber,
    beforeBlock,
    (fromBlock, toBlock) =>
      client.getLogs({
        address: snapshot.base.address,
        event: bidEvent,
        args: { nftId: BigInt(tokenId) },
        strict: true,
        fromBlock,
        toBlock,
      }),
  );
  const bids = rows
    .filter((row) => !row.removed)
    .map((row) => ({
      ...row.args,
      blockNumber: row.blockNumber,
      logIndex: row.logIndex,
      hash: row.transactionHash,
    }))
    .sort(newest);
  return { bids, nextBeforeBlock };
}

export async function readAuctionSales(beforeBlock?: bigint, tokenId?: number) {
  if (tokenId !== undefined) checkId(tokenId);
  const snapshot = await verifiedSnapshot();
  return readSettlementsPage(
    snapshot,
    snapshot.deploymentBlock,
    beforeBlock,
    tokenId,
  );
}

/** A caller may pin a narrower historical interval while retaining the same verified deployment. */
export async function readSettlementsPage(
  snapshot: Snapshot,
  floor: bigint,
  beforeBlock?: bigint,
  tokenId?: number,
) {
  const { rows, nextBeforeBlock } = await eventPage(
    floor,
    snapshot.blockNumber,
    beforeBlock,
    (fromBlock, toBlock) =>
      client.getLogs({
        address: snapshot.base.address,
        event: saleEvent,
        args: tokenId === undefined ? {} : { nftId: BigInt(tokenId) },
        strict: true,
        fromBlock,
        toBlock,
      }),
  );
  const accepted = rows.filter((row) => !row.removed);
  const blocks = await Promise.all(
    [...new Set(accepted.map((row) => row.blockNumber))].map(
      async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber, block.timestamp] as const;
      },
    ),
  );
  const times = new Map(blocks);
  const sales = accepted
    .map((row) => {
      const id = Number(row.args.nftId);
      checkId(id);
      return {
        tokenId: id,
        roundNum: row.args.roundNum,
        winner: row.args.winner,
        amount: row.args.amount,
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        hash: row.transactionHash,
        timestamp: times.get(row.blockNumber)!,
      };
    })
    .sort(newest);
  return { sales, nextBeforeBlock };
}
