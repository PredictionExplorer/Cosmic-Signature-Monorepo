"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { readWalletActivity } from "@/lib/auctions/client";
import type { AuctionLot } from "@/lib/auctions/types";
import { shortenAddress } from "@/lib/utils";
import { CataloguePagination, ChainTime, Price } from "./auction-display";
import {
  RecipientAction,
  TransactionStatus,
  WalletGate,
  useAuctionTransaction,
} from "./auction-wallet";
import styles from "./auction.module.css";

export function AuctionAccount({ page }: { page: number }) {
  const { address } = useAccount();
  if (!address)
    return (
      <div className={styles.message}>
        <h2>Connect your wallet</h2>
        <p>See your leading bids, won artworks and available ETH refunds.</p>
        <ConnectWalletButton />
      </div>
    );
  return <ConnectedAccount key={address} address={address} page={page} />;
}

function ConnectedAccount({
  address,
  page,
}: {
  address: Address;
  page: number;
}) {
  const query = useQuery({
    queryKey: ["auction", "wallet", address, page],
    queryFn: () => readWalletActivity(address, page),
    refetchInterval: 8_000,
    retry: 1,
  });
  const tx = useAuctionTransaction();
  const info = query.data;
  if (!info)
    return (
      <div className={styles.message}>
        {query.isError ? (
          <>
            <p role="alert">Wallet activity could not be read.</p>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </>
        ) : (
          <p role="status">Reading your auction activity…</p>
        )}
      </div>
    );
  return (
    <>
      {query.isError && (
        <p className={styles.notice} role="alert">
          Wallet data could not be refreshed.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Refresh
          </button>
        </p>
      )}
      <section
        className={styles.credit}
        aria-labelledby="available-refund-title"
      >
        <div>
          <h2 className={styles.creditTitle} id="available-refund-title">
            Available refund
          </h2>
          <div className={styles.creditAmount}>
            <Price wei={info.refund} />
          </div>
          <p>
            Across all lots for{" "}
            <span title={address}>{shortenAddress(address)}</span>.{" "}
            {info.refund > 0n
              ? "You can withdraw the full balance now, even while bidding is open."
              : "When someone outbids this wallet, your bid becomes available here immediately."}
          </p>
        </div>
        <div>
          {info.refund > 0n && (
            <WalletGate>
              <RecipientAction
                owner={address}
                kind="withdrawRefund"
                disabled={tx.busy || query.isError}
                onAction={tx.run}
              />
            </WalletGate>
          )}
          <TransactionStatus state={tx.state} />
        </div>
      </section>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Your auction activity</p>
          <h2>
            {page === 0 ? "Latest cycle" : `Earlier cycle · page ${page + 1}`}
          </h2>
        </div>
      </div>
      {BigInt(page) >= info.count && page > 0 ? (
        <p>
          No cycle on this page.{" "}
          <Link href="/auctions/account" className={styles.textLink}>
            View latest cycle
          </Link>
        </p>
      ) : (
        <>
          <AccountList
            title="Leading bids"
            lots={info.leading}
            empty="You have no leading bids in this cycle."
          />
          <AccountList
            title="Won artworks"
            lots={info.won}
            empty="You have no won artworks in this cycle."
          />
        </>
      )}
      <CataloguePagination
        page={page}
        count={info.count}
        base="/auctions/account"
      />
    </>
  );
}

function AccountList({
  title,
  lots,
  empty,
}: {
  title: string;
  lots: AuctionLot[];
  empty: string;
}) {
  return (
    <section className={styles.accountList}>
      <h3>{title}</h3>
      {lots.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {lots.map((lot) => (
            <li key={lot.tokenId}>
              <Link href={`/auctions/${lot.tokenId}`}>
                <div>
                  <strong>Signature #{lot.tokenId}</strong>
                  <span>
                    {lot.delivered ? (
                      "Delivered"
                    ) : lot.settled ? (
                      "Ready to collect"
                    ) : title === "Won artworks" ? (
                      "Awaiting settlement"
                    ) : (
                      <>
                        Closes <ChainTime timestamp={lot.endAt} />
                      </>
                    )}
                  </span>
                </div>
                <Price wei={lot.highestBid} />
                <ArrowUpRight size={18} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
