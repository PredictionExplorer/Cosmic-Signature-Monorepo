import { notFound } from "next/navigation";
import {
  AuctionNav,
  AuctionTerms,
} from "@/components/auctions/auction-display";
import { AuctionHistory } from "@/components/auctions/auction-history";
import { AuctionLotView } from "@/components/auctions/auction-lot";
import styles from "@/components/auctions/auction.module.css";
import { readLot } from "@/lib/auctions/client";
import { auctionConfigured } from "@/lib/auctions/config";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getCosmicSignatureApiBase } from "@/lib/server-rotation";

type LotPageProps = { params: Promise<{ tokenId: string }> };
export const dynamic = "force-dynamic";

function lotId(value: string) {
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    notFound();
  return Number(value);
}

export async function generateMetadata({ params }: LotPageProps) {
  const id = lotId((await params).tokenId);
  return buildPageMetadata({
    title: `Cosmic Signature #${id} auction`,
    description: `View the artwork, current bid and auction history for Cosmic Signature #${id}.`,
    path: `/auctions/${id}`,
  });
}

export default async function LotPage({ params }: LotPageProps) {
  const id = lotId((await params).tokenId);
  if (!auctionConfigured) notFound();
  const initial = await readLot(id);
  if (!initial) notFound();
  return (
    <div className={styles.shell} data-accent="chartreuse">
      <AuctionNav detail />
      <AuctionLotView
        initial={initial}
        mediaOrigin={getCosmicSignatureApiBase()}
      />
      <AuctionHistory tokenId={id} />
      <AuctionTerms />
    </div>
  );
}
