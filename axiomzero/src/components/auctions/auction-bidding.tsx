"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { formatEther, isAddressEqual, type Address } from "viem";
import {
  bidFunding,
  parseEthInput,
  type AuctionLot,
} from "@/lib/auctions/types";
import type { AuctionAction } from "@/lib/auctions/actions";

import { Price } from "./auction-display";
import styles from "./auction.module.css";

export function BidForm({
  lot,
  busy,
  onAction,
}: {
  lot: AuctionLot;
  busy: boolean;
  onAction: (action: AuctionAction) => Promise<boolean>;
}) {
  const { address } = useAccount();
  const descriptionId = useId();
  const reviewId = useId();
  const amountField = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const editing = useRef(false);
  const [input, setInput] = useState<string | null>(null);
  const [review, setReview] = useState<
    | {
        total: bigint;
        funding: bigint;
        tokenId: number;
        account: Address;
        minimum: bigint;
      }
    | "expired"
    | null
  >(null);
  const display = input ?? formatEther(lot.minimumNextBid);
  const total = parseEthInput(display);
  const eligible = address && total !== null && total >= lot.minimumNextBid;
  const due = eligible ? bidFunding(lot, total, address) : null;
  const selfRaise = !!address && isAddressEqual(lot.highestBidder, address);
  const currentReview =
    !!review &&
    review !== "expired" &&
    !!address &&
    review.tokenId === lot.tokenId &&
    isAddressEqual(review.account, address) &&
    review.total === total &&
    review.funding === due &&
    review.minimum === lot.minimumNextBid;
  useEffect(() => {
    if (currentReview) reviewHeading.current?.focus();
    else if (editing.current) {
      editing.current = false;
      amountField.current?.focus();
    }
  }, [currentReview]);
  // Invalidation is permanent. Navigating back to a wallet or lot with the
  // same terms must still require the collector to review the bid again.
  if (review && review !== "expired" && !currentReview) setReview("expired");

  function showReview(event: FormEvent) {
    event.preventDefault();
    if (!eligible || !address || total === null || due === null || busy) return;
    setReview({
      total,
      funding: due,
      tokenId: lot.tokenId,
      account: address,
      minimum: lot.minimumNextBid,
    });
  }
  async function confirm() {
    if (!currentReview || busy) return;
    const accepted = await onAction({
      kind: "bid",
      tokenId: review.tokenId,
      total: review.total,
      expectedFunding: review.funding,
    });
    setReview(null);
    if (accepted) setInput(null);
  }

  if (currentReview)
    return (
      <section className={styles.form} aria-labelledby={reviewId}>
        <div className={styles.review}>
          <h3 id={reviewId} ref={reviewHeading} tabIndex={-1}>
            Review your bid
          </h3>
          <dl>
            <div>
              <dt>Total bid</dt>
              <dd>
                <Price wei={review.total} />
              </dd>
            </div>
            <div>
              <dt>Due from wallet</dt>
              <dd>
                <Price wei={review.funding} />
              </dd>
            </div>
          </dl>
          <p>
            Network gas is extra. Approving in your wallet places a binding bid.
            If someone outbids you, withdraw your full bid immediately from
            Available refund in your collector account.
          </p>
        </div>
        <button
          type="button"
          className={styles.action}
          disabled={busy}
          onClick={() => void confirm()}
        >
          Confirm in wallet
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => {
            editing.current = true;
            setReview(null);
          }}
        >
          Edit bid
        </button>
      </section>
    );
  const invalid = total === null || total < lot.minimumNextBid;
  return (
    <form className={styles.form} onSubmit={showReview}>
      <label>
        Total bid (ETH)
        <input
          ref={amountField}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          value={display}
          aria-describedby={descriptionId}
          aria-invalid={invalid}
          onChange={(e) => {
            setReview(null);
            setInput(e.target.value);
          }}
        />
      </label>
      <p id={descriptionId} className={invalid ? styles.warning : undefined}>
        {invalid
          ? `Enter at least ${formatEther(lot.minimumNextBid)} ETH, using up to 18 decimal places.`
          : selfRaise
            ? "Your leading bid is already funded. You pay only the increase, plus gas."
            : "The minimum is filled in. You can enter a higher amount."}
      </p>
      {review === "expired" && (
        <p role="status">
          The lot or connected wallet changed. Review the latest amount before
          confirming.
        </p>
      )}
      <button
        className={styles.action}
        type="submit"
        disabled={!eligible || busy}
      >
        Review bid
      </button>
    </form>
  );
}
