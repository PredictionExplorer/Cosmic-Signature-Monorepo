import { notFound } from "next/navigation";
import { AuctionAccount } from "@/components/auctions/auction-account";
import { AuctionNav, pageNumber } from "@/components/auctions/auction-display";
import styles from "@/components/auctions/auction.module.css";
import { auctionConfigured } from "@/lib/auctions/config";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = {
  ...buildPageMetadata({
    title: "Auction collector account",
    description:
      "Review your leading bids, won artworks and ETH refund credit.",
    path: "/auctions/account",
  }),
  robots: { index: false },
};
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();
  return (
    <div className={styles.shell} data-accent="chartreuse">
      <AuctionNav account />
      <header className={styles.intro}>
        <p className={styles.kicker}>Cycle auctions</p>
        <h1>Collector account</h1>
      </header>
      {auctionConfigured ? (
        <div id="refunds" className={styles.refundAnchor}>
          <AuctionAccount page={page} />
        </div>
      ) : (
        <p className={styles.message}>
          Wallet activity will be available when the first auction is
          registered.
        </p>
      )}
    </div>
  );
}
