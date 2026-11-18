"use client";

import { useState, type FormEvent } from "react";
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
  const [input, setInput] = useState<string | null>(null);
  const [review, setReview] = useState<{
    total: bigint;
    funding: bigint;
    tokenId: number;
    account: Address;
  } | null>(null);
  const display = input ?? formatEther(lot.minimumNextBid);
  const total = parseEthInput(display);
  const eligible = address && total !== null && total >= lot.minimumNextBid;
  const due = eligible ? bidFunding(lot, total, address) : null;
  const selfRaise = !!address && isAddressEqual(lot.highestBidder, address);
  const currentReview =
    !!review &&
    !!address &&
    review.tokenId === lot.tokenId &&
    isAddressEqual(review.account, address) &&
    review.total === total &&
    review.funding === due;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!eligible || !address || due === null || total === null || busy) return;
    if (!currentReview) {
      setReview({
        total,
        funding: due,
        tokenId: lot.tokenId,
        account: address,
      });
      return;
    }
    const accepted = await onAction({
      kind: "bid",
      tokenId: lot.tokenId,
      total,
      expectedFunding: due,
    });
    setReview(null);
    if (accepted) setInput(null);
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        Total bid (ETH)
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          value={display}
          onChange={(e) => {
            setReview(null);
            setInput(e.target.value);
          }}
          aria-invalid={total === null || total < lot.minimumNextBid}
        />
      </label>

      {input !== null && !eligible && address && (
        <p className={styles.warning}>
          Enter an ETH amount at or above the current minimum, with up to 18
          decimal places.
        </p>
      )}
      {selfRaise && (
        <p>
          Your leading bid is already in escrow. You fund only the increase.
        </p>
      )}
      {currentReview && due !== null && (
        <div className={styles.review}>
          <p className={styles.kicker}>Review bid</p>
          <div>
            <span>Total bid</span>
            <Price wei={review.total} />
          </div>
          <div>
            <span>Due from wallet</span>
            <Price wei={due} />
          </div>
          <small>Network gas is additional. A confirmed bid is binding.</small>
        </div>
      )}
      {review && !currentReview && (
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
        {currentReview ? "Confirm bid" : "Place bid"}
      </button>
    </form>
  );
}
