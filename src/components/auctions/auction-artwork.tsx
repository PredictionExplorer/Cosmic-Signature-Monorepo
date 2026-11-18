"use client";

import Image from "next/image";
import { useState } from "react";

import styles from "./auction.module.css";

/** Only request media derived from the NFT's on-chain seed. A new seed may still be in the rendering queue. */
export function AuctionArtwork({
  seed,
  tokenId,
  mediaOrigin,
  large = false,
  priority = false,
}: {
  seed: string;
  tokenId: number;
  mediaOrigin: string;
  large?: boolean;
  priority?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const root = `${mediaOrigin}/images/new/cosmicsignature/${seed}`;
  const src =
    attempt === 0
      ? `${root}/images/web/${large ? "ember_full.webp" : "ember_preview.webp"}`
      : large
        ? `${root}.png`
        : `${root}/thumb_black.webp`;
  return (
    <div className={styles.artwork} data-large={large}>
      {attempt >= 2 ? (
        <span className={styles.rendering}>Artwork preview unavailable</span>
      ) : (
        <Image
          fill
          unoptimized
          src={src}
          alt={`Three-body artwork for Cosmic Signature #${tokenId}`}
          fetchPriority={priority ? "high" : "auto"}
          loading={priority ? "eager" : "lazy"}
          onError={() => setAttempt(attempt + 1)}
          sizes={
            large
              ? "(min-width: 900px) 62vw, 100vw"
              : "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          }
        />
      )}
    </div>
  );
}
