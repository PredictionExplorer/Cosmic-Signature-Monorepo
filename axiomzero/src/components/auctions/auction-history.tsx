"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { readBidHistory } from "@/lib/auctions/client";
import { shortenAddress } from "@/lib/utils";
import { Price } from "./auction-display";
import { ChainLink } from "./auction-wallet";
import styles from "./auction.module.css";

export function AuctionHistory({ tokenId }: { tokenId: number }) {
  const history = useInfiniteQuery({
    queryKey: ["auction", "bids", tokenId],
    queryFn: ({ pageParam }) =>
      readBidHistory(
        tokenId,
        pageParam === null ? undefined : BigInt(pageParam),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBeforeBlock?.toString(),
    refetchInterval: 15_000,
    retry: 1,
  });
  const bids = history.data?.pages.flatMap((page) => page.bids) ?? [];
  return (
    <section className={styles.history} aria-labelledby="history-title">
      <h2 id="history-title">Bid history</h2>
      {history.isPending && <p role="status">Reading confirmed bids…</p>}
      {history.isError && (
        <div className={styles.notice} role="alert">
          Bid history could not be refreshed.{" "}
          <button type="button" onClick={() => void history.refetch()}>
            Try again
          </button>
        </div>
      )}
      {bids.length > 0 ? (
        <ol className={styles.bidList}>
          {bids.map((bid) => (
            <li key={`${bid.hash}-${bid.logIndex}`}>
              <div>
                <strong title={bid.bidder}>{shortenAddress(bid.bidder)}</strong>
                <span>
                  <ChainLink hash={bid.hash}>
                    Block {String(bid.blockNumber)}
                  </ChainLink>
                </span>
              </div>
              <Price wei={bid.amount} />
            </li>
          ))}
        </ol>
      ) : (
        history.isSuccess && (
          <p>
            {history.hasNextPage
              ? "No bids in the blocks loaded so far."
              : "No bids recorded for this artwork."}
          </p>
        )
      )}
      {history.hasNextPage && (
        <button
          type="button"
          className={styles.secondary}
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage
            ? "Loading older blocks…"
            : "Load older blocks"}
        </button>
      )}
    </section>
  );
}
