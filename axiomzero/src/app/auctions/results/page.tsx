import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEther } from "viem";
import { AuctionNav } from "@/components/auctions/auction-display";
import styles from "@/components/auctions/auction.module.css";
import {
  auctionConfigured,
  auctionChainId,
  readAuctionSales,
} from "@/lib/auctions/client";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { logMarketplaceDegradation } from "@/lib/marketplace/log";
import { shortenAddress } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = buildPageMetadata({
  title: "Auction results",
  description:
    "Completed Cosmic Signature artwork sales, final ETH prices and settlement records on Arbitrum.",
  path: "/auctions/results",
});
type SalePage = Awaited<ReturnType<typeof readAuctionSales>>;

export default async function AuctionResults({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const { before } = await searchParams;
  if (
    before !== undefined &&
    (typeof before !== "string" || !/^(0|[1-9]\d{0,19})$/.test(before))
  )
    notFound();
  let results: SalePage | undefined;
  if (auctionConfigured) {
    try {
      results = await readAuctionSales(before ? BigInt(before) : undefined);
    } catch (error) {
      logMarketplaceDegradation("auction results unavailable", error);
    }
  }
  return (
    <div className={styles.shell} data-accent="chartreuse">
      <AuctionNav results />
      <header className={styles.intro}>
        <h1>Auction results</h1>
        <p className={styles.introCopy}>
          Each settled lot appears once, with its final price and winning
          wallet.
        </p>
      </header>
      {!auctionConfigured ? (
        <p className={styles.message}>
          The V4 auction contract is awaiting activation.
        </p>
      ) : !results ? (
        <p role="status">
          Auction results are temporarily unavailable. Reload to check again.
        </p>
      ) : (
        <>
          {results.sales.length ? (
            <div
              role="region"
              aria-label="Sale results table"
              tabIndex={0}
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-chartreuse"
            >
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Settled Cosmic Signature artworks
                </caption>
                <thead className="text-sm text-bone">
                  <tr>
                    {[
                      "Artwork",
                      "Cycle",
                      "Final price",
                      "Winning wallet",
                      "Settled (UTC)",
                    ].map((label) => (
                      <th
                        scope="col"
                        key={label}
                        className="border-b border-ivory/30 px-3 py-3"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.sales.map((sale) => (
                    <tr key={`${sale.hash}-${sale.logIndex}`}>
                      <th
                        scope="row"
                        className="border-b border-ivory/15 px-3 py-5"
                      >
                        <Link
                          className="text-copper underline-offset-4 hover:underline"
                          href={`/auctions/${sale.tokenId}`}
                        >
                          Cosmic Signature #{sale.tokenId}
                        </Link>
                      </th>
                      <td className="border-b border-ivory/15 px-3">
                        {sale.roundNum.toString()}
                      </td>
                      <td className="whitespace-nowrap border-b border-ivory/15 px-3 font-mono">
                        {formatEther(sale.amount)} ETH
                      </td>
                      <td
                        className="border-b border-ivory/15 px-3 font-mono"
                        title={sale.winner}
                      >
                        {shortenAddress(sale.winner, 6)}
                      </td>
                      <td className="whitespace-nowrap border-b border-ivory/15 px-3">
                        {auctionChainId === 42161 ? (
                          <a
                            href={`https://arbiscan.io/tx/${sale.hash}`}
                            className="underline"
                          >
                            {settlementTime(sale.timestamp)}
                          </a>
                        ) : (
                          settlementTime(sale.timestamp)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {results.nextBeforeBlock !== null || before !== undefined
                ? "No sales settled in this block range."
                : "No lots have settled yet."}
            </p>
          )}
          <nav
            aria-label="Settlement history pages"
            className="mt-8 flex gap-6 text-copper"
          >
            {before !== undefined && (
              <Link href="/auctions/results" className="py-3 underline">
                Newest results
              </Link>
            )}
            {results.nextBeforeBlock !== null && (
              <Link
                rel="next"
                href={`/auctions/results?before=${results.nextBeforeBlock}`}
                className="py-3 underline"
              >
                Earlier results
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}

function settlementTime(timestamp: bigint) {
  const iso = new Date(Number(timestamp) * 1000).toISOString();
  return <time dateTime={iso}>{iso.slice(0, 16).replace("T", " ")}</time>;
}
