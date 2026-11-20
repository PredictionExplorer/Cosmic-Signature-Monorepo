import { isAddressEqual, type Address, type Hex } from "viem";

export type AuctionLot = {
  tokenId: number;
  seed: Hex;
  roundNum: bigint;
  openingBid: bigint;
  minimumNextBid: bigint;
  eligibleAt: bigint;
  endAt: bigint;
  highestBidder: Address;
  highestBid: bigint;
  settled: boolean;
  delivered: boolean;
  proceedsForwarded: boolean;
};

export function phaseOf(
  lot: Pick<AuctionLot, "settled" | "eligibleAt" | "endAt">,
  time: bigint,
) {
  if (lot.settled) return "settled";
  if (time < lot.eligibleAt) return "preview";
  if (lot.endAt === 0n) return "waiting";
  return time < lot.endAt ? "active" : "ended";
}

export function parseEthInput(value: string): bigint | null {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  return amount < 1n << 256n ? amount : null;
}

export function bidFunding(lot: AuctionLot, total: bigint, account: Address) {
  if (total < lot.minimumNextBid || total >= 1n << 256n) {
    throw new RangeError("The bid is outside the contract’s current limits.");
  }
  return isAddressEqual(lot.highestBidder, account)
    ? total - lot.highestBid
    : total;
}

export function checkId(id: number) {
  if (!Number.isSafeInteger(id) || id < 0)
    throw new RangeError("Invalid token or page number.");
}
