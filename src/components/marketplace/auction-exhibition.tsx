import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AuctionArtwork } from "@/components/auctions/auction-artwork";
import type { AuctionLot } from "@/lib/auctions/types";
import { getCosmicSignatureApiBase } from "@/lib/server-rotation";

export function AuctionExhibition({ lots }: { lots: readonly AuctionLot[] }) {
  const firstLot = lots[0];
  const mediaOrigin = getCosmicSignatureApiBase();
  return (
    <section
      aria-labelledby="cycle-auctions-title"
      className="border-y border-ivory/15 py-7 sm:py-10"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="cycle-auctions-title"
            className="font-display text-3xl font-semibold tracking-tight text-ivory sm:text-4xl"
          >
            {firstLot
              ? `Cycle ${firstLot.roundNum} auctions`
              : "Cosmic Signature auctions"}
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-bone/80">
            {firstLot
              ? "Eight works from the latest cycle. Each has its own bidding clock."
              : "Explore the sale terms for the eight artworks created at each V4 cycle close."}
          </p>
        </div>
        <Link
          href="/auctions"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-copper underline-offset-4 hover:underline"
        >
          Auction catalogue <ArrowUpRight aria-hidden size={16} />
        </Link>
      </div>
      {firstLot && (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {lots.map((lot) => (
            <li key={lot.tokenId}>
              <Link
                href={`/auctions/${lot.tokenId}`}
                aria-label={`View auction for Cosmic Signature #${lot.tokenId}`}
                className="group block"
              >
                <div className="aspect-square overflow-hidden rounded-lg bg-carbon">
                  <AuctionArtwork
                    seed={lot.seed}
                    tokenId={lot.tokenId}
                    mediaOrigin={mediaOrigin}
                  />
                </div>
                <span className="mt-2 block font-mono text-xs text-bone group-hover:text-ivory">
                  #{lot.tokenId}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
