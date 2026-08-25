"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { useBuyListing } from "@/lib/marketplace/use-buy-listing";
import type {
  Collection,
  MarketOffer,
  TokenArtwork,
} from "@/lib/marketplace/types";
import { formatEthWithUsd } from "@/lib/pricing/eth-usd";
import { cn, formatEth, formatTokenId, shortenAddress } from "@/lib/utils";

/**
 * Quick-buy entry point for browse surfaces: a compact trigger that opens a
 * purchase confirmation dialog. Wallet state is only read once the dialog is
 * open, so cards stay cheap to render in large grids.
 */
export function BuyNowButton({
  collection,
  tokenId,
  tokenName,
  artwork,
  offer,
  usdPerEth,
  triggerClassName,
}: {
  collection: Collection;
  tokenId: number;
  tokenName: string;
  artwork: TokenArtwork;
  offer: MarketOffer;
  usdPerEth?: number;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <>
      <Button
        type="button"
        aria-haspopup="dialog"
        className={cn("whitespace-nowrap", triggerClassName)}
        onClick={() => setOpen(true)}
      >
        Buy {formatEth(offer.priceEth)}
        <span className="sr-only">
          , opens the purchase confirmation for {tokenName}
        </span>
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(92vw,26rem)] rounded-[2rem] border border-ivory/12 bg-carbon p-0 text-bone shadow-[0_32px_120px_rgba(0,0,0,0.5)] backdrop:bg-ink/85"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            setOpen(false);
          }
        }}
      >
        {open ? (
          <PurchaseConfirmation
            collection={collection}
            tokenId={tokenId}
            tokenName={tokenName}
            artwork={artwork}
            offer={offer}
            usdPerEth={usdPerEth}
            titleId={titleId}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </dialog>
    </>
  );
}

function PurchaseConfirmation({
  collection,
  tokenId,
  tokenName,
  artwork,
  offer,
  usdPerEth,
  titleId,
  onDone,
}: {
  collection: Collection;
  tokenId: number;
  tokenName: string;
  artwork: TokenArtwork;
  offer: MarketOffer;
  usdPerEth?: number;
  titleId: string;
  onDone: () => void;
}) {
  const { buy, isPending, blocker, switchToArbitrum } = useBuyListing({
    collection,
    offer,
  });
  const usdPrice = formatEthWithUsd(offer.priceEth, usdPerEth);

  async function confirmPurchase() {
    if (await buy()) {
      onDone();
    }
  }

  return (
    <div className="p-6">
      <p className="text-xs uppercase tracking-[0.24em] text-copper">
        Confirm purchase
      </p>
      <h2
        id={titleId}
        className="font-display mt-2 text-2xl font-semibold tracking-[-0.03em] text-ivory"
      >
        {tokenName}
      </h2>

      <div className="mt-5 flex items-center gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl border border-ivory/10 bg-ink">
          <Image
            src={artwork.image}
            alt={artwork.alt}
            fill
            sizes="5rem"
            className="object-contain p-1"
          />
        </div>
        <div className="text-sm">
          <p className="text-bone/75">
            {collection.shortName} · {formatTokenId(tokenId)}
          </p>
          <p className="font-display mt-1 text-2xl font-semibold text-chartreuse">
            {formatEth(offer.priceEth)}
          </p>
          {usdPrice ? (
            <p className="mt-1 text-xs text-bone/70">≈ {usdPrice}</p>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 space-y-2 rounded-2xl bg-ink/48 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-bone/75">Seller</dt>
          <dd className="font-mono text-ivory">{shortenAddress(offer.maker)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-bone/75">Network</dt>
          <dd className="text-ivory">Arbitrum One</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-bone/75">Marketplace fee</dt>
          <dd className="font-semibold text-chartreuse">0%</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-5 text-bone/70">
        Settles instantly on-chain through the {collection.shortName}{" "}
        marketplace contract. You pay the listing price plus network gas.
        Review the wallet prompt before signing.
      </p>

      {blocker ? (
        <div className="mt-4 rounded-2xl border border-copper/20 bg-copper/10 p-4 text-sm leading-6 text-bone/82">
          <p>{blocker.message}</p>
          {blocker.kind === "disconnected" ? (
            <ConnectWalletButton className="mt-3" />
          ) : null}
          {blocker.kind === "wrong-chain" ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => void switchToArbitrum()}
            >
              Switch to Arbitrum
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={Boolean(blocker) || isPending}
          onClick={() => void confirmPurchase()}
        >
          {isPending ? "Confirming…" : `Buy for ${formatEth(offer.priceEth)}`}
        </Button>
      </div>
    </div>
  );
}
