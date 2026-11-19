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
import { readBatch } from "@/lib/auctions/client";
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
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();
  const batch = auctionConfigured ? await readBatch(page) : null;
  if (page > 0 && (!batch || BigInt(page) >= batch.count)) notFound();
  return (
    <div data-accent="chartreuse" className={styles.shell}>
      <AuctionNav />
      {batch ? (
        <LiveCatalogue
          initial={batch}
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
