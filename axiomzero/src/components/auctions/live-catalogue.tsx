"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { readBatch, readOpenLots } from "@/lib/auctions/client";
import { CatalogueIntroduction, LotGrid } from "./auction-catalogue";
import { CataloguePagination, ChainTime } from "./auction-display";
import styles from "./auction.module.css";

type Batch = Awaited<ReturnType<typeof readBatch>> & {
  nextBefore?: bigint | null;
  firstOpening?: bigint | null;
};

/** Hydrated from a single server-side block. New cycles, prices and deadlines then follow the chain. */
export function LiveCatalogue({
  initial,
  view,
  before,
  page,
  mediaOrigin,
}: {
  initial: Batch;
  view: "open" | "all";
  before?: number;
  page: number;
  mediaOrigin: string;
}) {
  const query = useQuery<Batch>({
    queryKey: ["auction", "catalogue", view, page, before],
    queryFn: () => (view === "open" ? readOpenLots(before) : readBatch(page)),
    initialData: initial,
    refetchInterval: 15_000,
    refetchOnMount: "always",
    retry: 1,
  });
  const batch = query.data;
  return (
    <>
      <CatalogueIntroduction registered={batch.count > 0n} />
      {batch.count > 0n && (
        <nav className={styles.catalogueViews} aria-label="Catalogue views">
          <Link
            href="/auctions?view=open"
            aria-current={view === "open" ? "page" : undefined}
          >
            Open for bids
          </Link>
          <Link
            href="/auctions?view=all"
            aria-current={view === "all" ? "page" : undefined}
          >
            All cycles
          </Link>
        </nav>
      )}
      {query.isError && (
        <p className={styles.notice} role="alert">
          Showing the last confirmed catalogue.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Refresh catalogue
          </button>
        </p>
      )}
      <LotGrid
        lots={batch.lots}
        blockTime={batch.blockTime}
        mediaOrigin={mediaOrigin}
      />
      {view === "open" && batch.count > 0n && batch.lots.length === 0 && (
        <section
          className={styles.openEmpty}
          aria-labelledby="open-empty-heading"
        >
          <h2 id="open-empty-heading">
            {batch.firstOpening
              ? "Bidding hasn’t opened yet"
              : "No open lots in these cycles"}
          </h2>
          {batch.firstOpening && (
            <p>
              The first lots open <ChainTime timestamp={batch.firstOpening} />.
            </p>
          )}
          {!batch.firstOpening && (
            <p>
              {batch.nextBefore
                ? "Continue to earlier cycles to look for works accepting bids."
                : "Browse all cycles for previews and completed auctions."}
            </p>
          )}
          {!batch.nextBefore && (
            <Link href="/auctions?view=all" className={styles.textLink}>
              Browse all cycles →
            </Link>
          )}
        </section>
      )}
      {view === "open" ? (
        (before !== undefined || batch.nextBefore != null) && (
          <nav aria-label="Open auction pages" className={styles.pages}>
            {before !== undefined && (
              <Link href="/auctions?view=open">Newest eligible cycle</Link>
            )}
            {batch.nextBefore != null && (
              <Link href={`/auctions?view=open&before=${batch.nextBefore}`}>
                Check earlier cycles →
              </Link>
            )}
          </nav>
        )
      ) : (
        <CataloguePagination
          page={page}
          count={batch.count}
          base="/auctions"
          firstHref="/auctions?view=all"
        />
      )}
    </>
  );
}
