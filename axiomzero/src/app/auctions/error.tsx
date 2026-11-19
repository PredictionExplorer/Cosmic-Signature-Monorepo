"use client";

import Link from "next/link";
import styles from "@/components/auctions/auction.module.css";

export default function AuctionReadError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.shell}>
      <section className={styles.message}>
        <h1>Auction data unavailable</h1>
        <p>
          The auction contract could not be verified or read. Check again for
          the latest on-chain state.
        </p>
        <div className={styles.row}>
          <button className={styles.action} type="button" onClick={reset}>
            Try again
          </button>
          <Link className={styles.textLink} href="/auctions">
            Back to auctions
          </Link>
        </div>
      </section>
    </div>
  );
}
