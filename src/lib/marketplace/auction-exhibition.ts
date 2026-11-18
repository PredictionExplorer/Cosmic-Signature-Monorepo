import { auctionConfigured, readBatch } from "@/lib/auctions/client";
import type { AuctionLot } from "@/lib/auctions/types";
import { logMarketplaceDegradation } from "./log";

/** Secondary-market pages remain accessible if the auction RPC is offline. */
export async function latestAuctionWorks(): Promise<AuctionLot[]> {
  if (!auctionConfigured) return [];
  try {
    return (await readBatch(0)).lots;
  } catch (error) {
    logMarketplaceDegradation("auction catalogue read unavailable", error);
    return [];
  }
}
