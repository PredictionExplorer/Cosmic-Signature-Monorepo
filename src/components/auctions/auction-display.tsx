import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Wallet,
} from "lucide-react";
import { formatEther } from "viem";

import { phaseOf, type AuctionLot } from "@/lib/auctions/types";
import styles from "./auction.module.css";

export function Price({ wei }: { wei: bigint }) {
  return (
    <span className={styles.price}>
      {formatEther(wei)} <small>ETH</small>
    </span>
  );
}

export function ChainTime({ timestamp }: { timestamp: bigint }) {
  const date = new Date(Number(timestamp) * 1000);
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(date)}{" "}
      UTC
    </time>
  );
}

const phaseLabels = {
  preview: "In preview",
  waiting: "Open for first bid",
  active: "Live bidding",
  ended: "Bidding ended",
  settled: "Sold",
} as const;

export function LotPhase({ lot, time }: { lot: AuctionLot; time: bigint }) {
  const phase = phaseOf(lot, time);
  return (
    <span className={styles.phase} data-phase={phase}>
      <i aria-hidden />
      {phaseLabels[phase]}
    </span>
  );
}

export function AuctionNav({
  account = false,
  detail = false,
  results = false,
}: {
  account?: boolean;
  detail?: boolean;
  results?: boolean;
}) {
  return (
    <nav className={styles.nav} aria-label="Auction navigation">
      <Link
        href="/auctions"
        aria-current={!detail && !account && !results ? "page" : undefined}
      >
        {(detail || account || results) && (
          <ChevronLeft size={15} aria-hidden />
        )}
        Auction catalogue
      </Link>
      <Link
        href="/auctions/results"
        aria-current={results ? "page" : undefined}
      >
        Sale results
      </Link>
      <Link
        href="/auctions/account"
        aria-current={account ? "page" : undefined}
      >
        <Wallet size={15} aria-hidden />
        Collector account
      </Link>
    </nav>
  );
}

export function CataloguePagination({
  page,
  count,
  base,
}: {
  page: number;
  count: bigint;
  base: string;
}) {
  if (count < 2n) return null;
  function href(p: number) {
    return p === 0 ? base : `${base}?page=${p + 1}`;
  }
  return (
    <nav className={styles.pages} aria-label="Auction cycle pages">
      {page > 0 && (
        <Link href={href(page - 1)}>
          <ChevronLeft size={16} aria-hidden />
          Newer cycle
        </Link>
      )}
      <span>
        Cycle page {page + 1} of {String(count)}
      </span>
      {BigInt(page + 1) < count && (
        <Link href={href(page + 1)}>
          Older cycle
          <ChevronRight size={16} aria-hidden />
        </Link>
      )}
    </nav>
  );
}

export function AuctionTerms() {
  return (
    <details className={styles.terms}>
      <summary>
        How these auctions work
        <ArrowDownRight size={20} aria-hidden />
      </summary>
      <dl>
        <div>
          <dt>Seven-day preview</dt>
          <dd>
            The game registers eight new works at each cycle close. Each lot
            shows its own opening minimum. Once eligible, it stays open for a
            first bid.
          </dd>
        </div>
        <div>
          <dt>48-hour bidding</dt>
          <dd>
            The first funded bid starts the clock for that work. Each new bid
            must raise the price by at least 10%. A bid in the final ten minutes
            restores ten minutes to the clock.
          </dd>
        </div>
        <div>
          <dt>Payment and collection</dt>
          <dd>
            Bids are binding and funded in ETH. Outbid funds become available to
            withdraw. Anyone can settle after closing, and the winner chooses a
            delivery address. The full sale price goes to the game reserve.
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function CollectionLink() {
  return (
    <Link href="/cosmic-signature" className={styles.textLink}>
      Explore the collection
      <ArrowUpRight size={16} aria-hidden />
    </Link>
  );
}

export function pageNumber(input: string | string[] | undefined) {
  if (input === undefined) return 0;
  if (
    typeof input !== "string" ||
    !/^[1-9]\d*$/.test(input) ||
    !Number.isSafeInteger(Number(input))
  )
    return null;
  return Number(input) - 1;
}
