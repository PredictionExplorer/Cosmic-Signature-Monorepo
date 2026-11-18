"use client";

import { useQuery } from "@tanstack/react-query";
import { readBatch } from "@/lib/auctions/client";
import { CatalogueIntroduction, LotGrid } from "./auction-catalogue";
import { CataloguePagination } from "./auction-display";
import styles from "./auction.module.css";

type Batch = Awaited<ReturnType<typeof readBatch>>;

/** Hydrated from a single server-side block. New cycles, prices and deadlines then follow the chain. */
export function LiveCatalogue({
  initial,
  page,
  mediaOrigin,
}: {
  initial: Batch;
  page: number;
  mediaOrigin: string;
}) {
  const query = useQuery({
    queryKey: ["auction", "catalogue", page],
    queryFn: () => readBatch(page),
    initialData: initial,
    refetchInterval: 15_000,
    refetchOnMount: "always",
    retry: 1,
  });
  const batch = query.data;
  return (
    <>
      <CatalogueIntroduction registered={batch.lots.length > 0} />
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
      <CataloguePagination page={page} count={batch.count} base="/auctions" />
    </>
  );
}
