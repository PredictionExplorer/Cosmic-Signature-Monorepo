import { unstable_cache } from "next/cache";
import { formatEther } from "viem";

import { auctionChainId, requireAuctionConfig } from "@/lib/auctions/config";
import { readSettlementsPage, verifiedSnapshot } from "@/lib/auctions/client";
import type { MarketSale } from "./types";

type PrimarySale = Extract<MarketSale, { source: "auction" }>;
type Page = { rows: PrimarySale[]; next: string | null };
type ReadPage = (floor: bigint, end: bigint) => Promise<Page>;

const WINDOW = 1_000_000n;
const PAGES_PER_REFRESH = 3;

/** Only complete, canonically finalized intervals advance the published watermark. */
export class SettlementIndex {
  private rows = new Map<string, PrimarySale>();
  private through: bigint;
  private window?: { end: bigint; cursor: bigint };

  constructor(deploymentBlock: bigint) {
    this.through = deploymentBlock - 1n;
  }

  async catchUp(
    finalized: bigint,
    read: ReadPage,
  ): Promise<PrimarySale[] | undefined> {
    if ((this.window?.end ?? this.through) > finalized)
      throw new Error("Finalized block moved backwards.");
    for (
      let work = 0;
      this.through < finalized && work < PAGES_PER_REFRESH;
      work++
    ) {
      const floor = this.through + 1n;
      const end =
        this.through + WINDOW < finalized ? this.through + WINDOW : finalized;
      this.window ??= { end, cursor: end };
      const page = await read(floor, this.window.cursor);
      const next = page.next === null ? null : BigInt(page.next);
      if (next !== null && (next < floor || next >= this.window.cursor)) {
        throw new Error("Invalid settlement history cursor.");
      }
      for (const row of page.rows) this.rows.set(row.settlementId, row);
      if (next === null) {
        this.through = this.window.end;
        this.window = undefined;
      } else {
        this.window.cursor = next;
      }
    }
    if (this.through < finalized) return undefined;
    return [...this.rows.values()];
  }
}

let index: SettlementIndex | undefined;
let refresh: Promise<PrimarySale[] | undefined> | undefined;
let lastComplete: { until: number; rows: PrimarySale[] } | undefined;

async function loadSales(): Promise<PrimarySale[] | undefined> {
  const snapshot = await verifiedSnapshot();
  const deployment = requireAuctionConfig();
  const local = auctionChainId === 31337;
  const finalized = local
    ? snapshot.blockNumber
    : (await snapshot.client.getBlock({ blockTag: "finalized" })).number;
  // Read no later than the deployment-verified head (RPC failover may observe a newer block).
  const end =
    finalized < snapshot.blockNumber ? finalized : snapshot.blockNumber;
  if (end < deployment.deploymentBlock) return [];
  const current = local
    ? new SettlementIndex(deployment.deploymentBlock)
    : (index ??= new SettlementIndex(deployment.deploymentBlock));
  return current.catchUp(end, async (floor, cursor) => {
    const read = async (): Promise<Page> => {
      const page = await readSettlementsPage(snapshot, floor, cursor);
      return {
        next: page.nextBeforeBlock?.toString() ?? null,
        rows: page.sales.map((row) => ({
          collectionId: "cosmic-signature",
          source: "auction",
          settlementId: `${auctionChainId}:${deployment.address.toLowerCase()}:${row.hash}:${row.logIndex}`,
          transactionHash: row.hash,
          logIndex: row.logIndex,
          roundNum: row.roundNum.toString(),
          tokenId: row.tokenId,
          priceEth: Number(formatEther(row.amount)),
          seller: deployment.address,
          buyer: row.winner,
          blockNumber: Number(row.blockNumber),
          soldAt: new Date(Number(row.timestamp) * 1000).toISOString(),
        })),
      };
    };
    // The local chain can be reset. Only cache finalized production pages across processes.
    return local
      ? read()
      : unstable_cache(
          read,
          [
            "axiom-auction-settlements-v1",
            String(auctionChainId),
            deployment.address,
            deployment.hash,
            deployment.deploymentBlock.toString(),
            floor.toString(),
            cursor.toString(),
          ],
          { revalidate: false },
        )();
  });
}

export function getPrimarySales(): Promise<PrimarySale[] | undefined> {
  if (
    auctionChainId !== 31337 &&
    lastComplete &&
    Date.now() < lastComplete.until
  ) {
    return Promise.resolve(lastComplete.rows);
  }
  refresh ??= loadSales()
    .then((rows) => {
      if (rows) lastComplete = { rows, until: Date.now() + 60_000 };
      return rows;
    })
    .finally(() => {
      refresh = undefined;
    });
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 5500);
    timer.unref?.();
  });
  return Promise.race([refresh, deadline]).finally(() => clearTimeout(timer));
}
