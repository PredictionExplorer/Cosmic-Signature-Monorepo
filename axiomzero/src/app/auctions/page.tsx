import { notFound } from "next/navigation";

import { CatalogueIntroduction } from "@/components/auctions/auction-catalogue";
import { LiveCatalogue } from "@/components/auctions/live-catalogue";
import {
  AuctionNav,
  AuctionTerms,
  pageNumber,
} from "@/components/auctions/auction-display";
import styles from "@/components/auctions/auction.module.css";
import { auctionConfigured } from "@/lib/auctions/config";
import { readBatch, readOpenLots } from "@/lib/auctions/client";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getCosmicSignatureApiBase } from "@/lib/server-rotation";

export const metadata = buildPageMetadata({
  title: "Cycle auctions",
  description:
    "Browse Cosmic Signature artworks by cycle and bid in their ETH auctions.",
  path: "/auctions",
});
export const dynamic = "force-dynamic";

export default async function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
    before?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // Historical ?page=N links always open the corresponding archive cycle.
  const view = params.view ?? (params.page === undefined ? "open" : "all");
  const page = pageNumber(params.page);
  const cursor = pageNumber(params.before);
  if (
    (view !== "open" && view !== "all") ||
    page === null ||
    cursor === null ||
    (view === "open" && params.page !== undefined) ||
    (view === "all" && params.before !== undefined)
  )
    notFound();
  const before = params.before === undefined ? undefined : cursor + 1;
  const batch = auctionConfigured
    ? view === "open"
      ? await readOpenLots(before)
      : await readBatch(page)
    : null;
  if (page > 0 && (!batch || BigInt(page) >= batch.count)) notFound();
  if (before !== undefined && (!batch || BigInt(before) > batch.count))
    notFound();
  return (
    <div data-accent="chartreuse" className={styles.shell}>
      <AuctionNav />
      {batch ? (
        <LiveCatalogue
          initial={batch}
          view={view}
          before={before}
          page={page}
          mediaOrigin={getCosmicSignatureApiBase()}
        />
      ) : (
        <CatalogueIntroduction registered={false} />
      )}
      <AuctionTerms />
    </div>
  );
}
