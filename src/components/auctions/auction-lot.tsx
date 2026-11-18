"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { isAddressEqual } from "viem";
import { readLot } from "@/lib/auctions/client";
import { phaseOf } from "@/lib/auctions/types";
import { shortenAddress } from "@/lib/utils";

import { AuctionArtwork } from "./auction-artwork";
import { BidForm } from "./auction-bidding";
import { ChainTime, LotPhase, Price } from "./auction-display";
import {
  CollectorLink,
  RecipientAction,
  TransactionStatus,
  WalletGate,
  useAuctionTransaction,
} from "./auction-wallet";
import styles from "./auction.module.css";

type Snapshot = NonNullable<Awaited<ReturnType<typeof readLot>>>;

export function remaining(seconds: bigint): string {
  if (seconds <= 0n) return "Awaiting chain update";
  const ds = seconds / 86400n,
    hs = (seconds % 86400n) / 3600n,
    ms = (seconds % 3600n) / 60n,
    ss = seconds % 60n;
  return ds
    ? `${ds}d ${hs}h ${ms}m`
    : `${hs}h ${String(ms).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

export function AuctionLotView({
  initial,
  mediaOrigin,
}: {
  initial: Snapshot;
  mediaOrigin: string;
}) {
  const { address } = useAccount();
  const tx = useAuctionTransaction();
  const id = initial.lot.tokenId;
  const query = useQuery({
    queryKey: ["auction", "lot", id],
    queryFn: () => readLot(id),
    initialData: initial,
    refetchInterval: 8_000,
    refetchOnMount: "always",
    retry: 1,
  });
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const snapshot = query.data ?? initial;
  const { lot, blockTime } = snapshot;
  const phase = phaseOf(lot, blockTime);
  const elapsed = Math.max(0, now - query.dataUpdatedAt);
  const clock = blockTime + BigInt(Math.floor(elapsed / 1000));
  const closing = phase === "preview" ? lot.eligibleAt : lot.endAt;
  const outdated = query.isError || query.data === null || elapsed > 45_000;
  const frozen = outdated || tx.busy;
  const canBuy =
    (phase === "active" && clock < lot.endAt) || phase === "waiting";
  const winner = !!address && isAddressEqual(lot.highestBidder, address);
  return (
    <>
      <header className={styles.lotHead}>
        <div>
          <p className={styles.kicker}>
            Cosmic Signature · Cycle {String(lot.roundNum)}
          </p>
          <h1>Signature #{id}</h1>
        </div>
        <LotPhase lot={lot} time={blockTime} />
      </header>
      <div className={styles.lotLayout}>
        <div>
          <AuctionArtwork
            key={lot.seed}
            seed={lot.seed}
            tokenId={id}
            mediaOrigin={mediaOrigin}
            large
            priority
          />
          <div className={styles.provenance}>
            <div>
              <span>On-chain artwork seed</span>
              <code>{lot.seed}</code>
            </div>
            <Link
              href={`/token/cosmic-signature/${id}`}
              className={styles.textLink}
            >
              Token record
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
        <aside className={styles.bidPanel} aria-label="Auction bidding">
          <p className={styles.kicker}>
            {lot.settled
              ? "Sale price"
              : lot.highestBid
                ? "Highest bid"
                : "Opening bid"}
          </p>
          <div className={styles.heroPrice}>
            <Price wei={lot.highestBid || lot.openingBid} />
          </div>
          {lot.highestBid > 0n && (
            <p className={styles.leader}>
              {lot.settled ? "Winner" : "Leading wallet"}{" "}
              <span title={lot.highestBidder}>
                {shortenAddress(lot.highestBidder)}
              </span>
              {winner ? " · You" : ""}
            </p>
          )}
          <div className={styles.bidTiming}>
            {phase === "active" || phase === "preview" ? (
              <>
                <span>
                  {phase === "preview" ? "Bidding opens in" : "Time remaining"}
                </span>
                <strong>{remaining(closing - clock)}</strong>
                <ChainTime timestamp={closing} />
              </>
            ) : phase === "waiting" ? (
              <>
                <span>Open for first bid</span>
                <p>The first funded bid starts this lot’s 48-hour clock.</p>
              </>
            ) : (
              <>
                <span>Bidding closed</span>
                <ChainTime timestamp={lot.endAt} />
              </>
            )}
          </div>
          {phase === "active" && (
            <p className={styles.minimum}>
              Next minimum <Price wei={lot.minimumNextBid} />
            </p>
          )}
          {outdated && (
            <div className={styles.notice} role="alert">
              Live auction data is unavailable. Transactions are paused.{" "}
              <button type="button" onClick={() => void query.refetch()}>
                Refresh
              </button>
            </div>
          )}
          {canBuy && (
            <WalletGate>
              <BidForm lot={lot} busy={frozen} onAction={tx.run} />
            </WalletGate>
          )}
          {phase === "ended" && (
            <>
              <p>
                The deadline has passed. Anyone can settle this lot to record
                its winner.
              </p>
              <WalletGate>
                <button
                  type="button"
                  disabled={frozen}
                  className={styles.action}
                  onClick={() => void tx.run({ kind: "settle", tokenId: id })}
                >
                  Settle auction
                </button>
              </WalletGate>
            </>
          )}
          {phase === "settled" && (
            <>
              <dl className={styles.settlement}>
                <div>
                  <dt>Artwork delivery</dt>
                  <dd>{lot.delivered ? "Delivered" : "Awaiting collection"}</dd>
                </div>
                <div>
                  <dt>Game reserve</dt>
                  <dd>
                    {lot.proceedsForwarded
                      ? "Proceeds received"
                      : "Ready to forward"}
                  </dd>
                </div>
              </dl>
              {!lot.delivered && (
                <WalletGate>
                  {winner && address ? (
                    <RecipientAction
                      key={address}
                      kind="claimNft"
                      owner={address}
                      tokenId={id}
                      onAction={tx.run}
                      disabled={frozen}
                    />
                  ) : (
                    <p>
                      Only the winning wallet can choose the delivery address.
                    </p>
                  )}
                </WalletGate>
              )}
              {!lot.proceedsForwarded && (
                <WalletGate>
                  <button
                    type="button"
                    disabled={frozen}
                    className={styles.secondary}
                    onClick={() =>
                      void tx.run({ kind: "forwardProceeds", tokenId: id })
                    }
                  >
                    Send proceeds to reserve
                  </button>
                </WalletGate>
              )}
            </>
          )}
          <TransactionStatus state={tx.state} />
          <CollectorLink />
        </aside>
      </div>
    </>
  );
}
