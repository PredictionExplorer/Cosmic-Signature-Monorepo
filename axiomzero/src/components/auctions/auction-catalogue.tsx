import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { phaseOf, type AuctionLot } from "@/lib/auctions/types";
import { AuctionArtwork } from "./auction-artwork";
import { ChainTime, CollectionLink, LotPhase, Price } from "./auction-display";
import collectionArtwork from "./collection-31.webp";
import styles from "./auction.module.css";

export function CatalogueIntroduction({ registered }: { registered: boolean }) {
  return (
    <header className={registered ? styles.intro : styles.previewIntro}>
      <div>
        <p className={styles.kicker}>Cosmic Signature</p>
        <h1>Cycle auctions</h1>
        <p className={styles.introCopy}>
          {registered
            ? "Choose a work to place a bid in ETH. Each artwork has its own minimum bid and closing time."
            : "With v4, each Performance Cycle brings eight new works to auction. Browse the collection until the first sale opens."}
        </p>
        {!registered && <CollectionLink />}
      </div>
      {!registered && (
        <figure className={styles.previewArt}>
          <Image
            src={collectionArtwork}
            preload
            alt="Flowing orbital trails from Cosmic Signature #31"
            sizes="(min-width: 800px) 50vw, 100vw"
          />
          <figcaption>
            <Link href="/token/cosmic-signature/31">
              Collection artwork · Cosmic Signature #31
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </figcaption>
        </figure>
      )}
    </header>
  );
}

export function LotGrid({
  lots,
  blockTime,
  mediaOrigin,
}: {
  lots: AuctionLot[];
  blockTime: bigint;
  mediaOrigin: string;
}) {
  if (!lots.length) return null;
  const cycle = lots[0].roundNum;
  return (
    <section aria-labelledby="cycle-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Auction catalogue</p>
          <h2 id="cycle-heading">Cycle {String(cycle)}</h2>
        </div>
        <p>
          {lots.length} {lots.length === 1 ? "lot" : "lots"}
        </p>
      </div>
      <div className={styles.grid}>
        {lots.map((lot, index) => {
          const phase = phaseOf(lot, blockTime);
          const open = phase === "waiting" || phase === "active";
          return (
            <Link
              key={lot.tokenId}
              href={`/auctions/${lot.tokenId}`}
              className={styles.card}
              aria-label={`${open ? "Place a bid on" : "View auction for"} Cosmic Signature #${lot.tokenId}`}
            >
              <AuctionArtwork
                seed={lot.seed}
                tokenId={lot.tokenId}
                mediaOrigin={mediaOrigin}
                priority={index === 0}
              />
              <div className={styles.cardBody}>
                <LotPhase lot={lot} time={blockTime} />
                <div className={styles.cardTitle}>
                  <h3>Signature #{lot.tokenId}</h3>
                </div>
                <div className={styles.cardPrice}>
                  <span>
                    {open
                      ? "Minimum bid"
                      : lot.settled
                        ? "Sale price"
                        : lot.highestBid > 0n
                          ? "Highest bid"
                          : "Opening bid"}
                  </span>
                  <Price
                    wei={
                      open
                        ? lot.minimumNextBid
                        : lot.highestBid || lot.openingBid
                    }
                  />
                </div>
                <div className={styles.cardClock}>
                  {lot.endAt > 0n
                    ? blockTime < lot.endAt
                      ? "Closes "
                      : "Closed "
                    : phase === "preview"
                      ? "Bidding opens "
                      : "Open since "}
                  <ChainTime timestamp={lot.endAt || lot.eligibleAt} />
                </div>
                <span className={styles.cardAction} data-open={open}>
                  {open
                    ? "Place a bid"
                    : phase === "preview"
                      ? "View preview"
                      : "View auction"}{" "}
                  <ArrowUpRight size={16} aria-hidden />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
