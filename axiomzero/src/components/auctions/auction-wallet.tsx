"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import {
  isAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";

import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { auctionAddress, auctionChainId } from "@/lib/auctions/config";
import {
  AuctionConfirmationPending,
  submitAuctionAction,
  type AuctionAction,
} from "@/lib/auctions/actions";
import styles from "./auction.module.css";

export function ChainLink({
  hash,
  children,
}: {
  hash: Hex;
  children: ReactNode;
}) {
  return auctionChainId === 42161 ? (
    <a
      href={`https://arbiscan.io/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.textLink}
    >
      {children}
    </a>
  ) : (
    <span title={hash}>{children}</span>
  );
}

export function WalletGate({
  children,
  bidding = false,
}: {
  children: ReactNode;
  bidding?: boolean;
}) {
  const { address, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!address)
    return bidding ? (
      <div className={styles.bidConnect}>
        <p>
          Connect a wallet to review your bid in{" "}
          {auctionChainId === 31337 ? "test ETH" : "ETH on Arbitrum One"}.
        </p>
        <ConnectWalletButton connectLabel="Connect wallet to bid" />
      </div>
    ) : (
      <ConnectWalletButton />
    );
  if (chainId !== auctionChainId)
    return (
      <div>
        <button
          className={styles.action}
          type="button"
          disabled={isPending}
          onClick={() => switchChain({ chainId: auctionChainId })}
        >
          Switch to{" "}
          {auctionChainId === 42161 ? "Arbitrum One" : "local auction chain"}
        </button>
        {error && (
          <p role="alert">
            Network switch was not completed. Try again in your wallet.
          </p>
        )}
      </div>
    );
  return children;
}

type TxState = {
  stage: "idle" | "sign" | "confirm" | "done" | "unknown" | "failed";
  message?: string;
  hash?: Hex;
};

export function useAuctionTransaction() {
  const { address, connector } = useAccount();
  const cache = useQueryClient();
  const busy = useRef(false);
  const [state, setState] = useState<TxState>({ stage: "idle" });
  const run = useCallback(
    async (action: AuctionAction) => {
      if (busy.current || !connector || !address) return false;
      busy.current = true;
      setState({ stage: "sign" });
      try {
        const provider = (await connector.getProvider()) as EIP1193Provider;
        const receipt = await submitAuctionAction(
          provider,
          address,
          action,
          (hash) => setState({ stage: "confirm", hash }),
        );
        setState({
          stage: "done",
          hash: receipt.transactionHash,
          message:
            action.kind === "bid"
              ? "Bid confirmed."
              : action.kind === "withdrawRefund"
                ? "Refund withdrawn."
                : undefined,
        });
        await cache.invalidateQueries({ queryKey: ["auction"] });
        return true;
      } catch (error) {
        if (error instanceof AuctionConfirmationPending)
          setState({ stage: "unknown", hash: error.hash });
        else {
          const cause = error as {
            code?: number;
            name?: string;
            shortMessage?: string;
            message?: string;
          };
          const message =
            cause.code === 4001 || cause.name === "UserRejectedRequestError"
              ? "The wallet request was declined."
              : cause.shortMessage ||
                (error instanceof Error && error.constructor === Error
                  ? error.message
                  : "The transaction could not be completed. Refresh the lot and review its current terms.");
          setState({ stage: "failed", message });
        }
        return false;
      } finally {
        busy.current = false;
      }
    },
    [address, connector, cache],
  );
  return {
    run,
    state,
    busy:
      state.stage === "sign" ||
      state.stage === "confirm" ||
      state.stage === "unknown",
  };
}

export function TransactionStatus({ state }: { state: TxState }) {
  const messages = {
    idle: "",
    sign: "Review the transaction in your wallet.",
    confirm: "Transaction submitted. Waiting for confirmation.",
    done: state.message ?? "Transaction confirmed.",
    unknown:
      "Confirmation is unavailable. Check the transaction receipt before taking another action.",
    failed: state.message,
  };
  if (state.stage === "idle") return null;
  return (
    <div
      className={styles.notice}
      role={state.stage === "failed" ? "alert" : "status"}
    >
      {messages[state.stage]}{" "}
      {state.hash && (
        <ChainLink hash={state.hash}>
          Transaction {state.hash.slice(0, 8)}…
        </ChainLink>
      )}
    </div>
  );
}

export function RecipientAction({
  kind,
  tokenId,
  owner,
  onAction,
  disabled,
}: {
  kind: "claimNft" | "withdrawRefund";
  tokenId?: number;
  owner: Address;
  onAction: (action: AuctionAction) => Promise<boolean>;
  disabled: boolean;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const recipientHelpId = useId();
  const recipient = custom ?? owner;
  const valid =
    isAddress(recipient) &&
    !isAddressEqual(recipient, zeroAddress) &&
    (!auctionAddress || !isAddressEqual(recipient, auctionAddress));
  const delivery = kind === "claimNft";
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || disabled) return;
        if (delivery && tokenId !== undefined)
          void onAction({ kind, recipient, tokenId });
        else if (!delivery) void onAction({ kind, recipient });
      }}
    >
      <label>
        {delivery ? "Delivery address" : "Refund address"}
        <input
          className={styles.address}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={recipient}
          onChange={(e) => setCustom(e.target.value)}
          aria-invalid={!valid}
          aria-describedby={!valid || !delivery ? recipientHelpId : undefined}
        />
      </label>
      {!valid ? (
        <small className={styles.warning} id={recipientHelpId}>
          Enter a valid receiving wallet address.
        </small>
      ) : (
        !delivery && (
          <small id={recipientHelpId}>
            {custom && !isAddressEqual(recipient as Address, owner)
              ? "Your refund will go to the address above. Check it before approving."
              : "Your bidding wallet is filled in. Approve the withdrawal in your wallet to receive the ETH."}{" "}
            Network gas applies.
          </small>
        )
      )}
      <button
        className={styles.action}
        type="submit"
        disabled={!valid || disabled}
      >
        {delivery ? "Collect artwork" : "Withdraw refund"}
      </button>
    </form>
  );
}

export function CollectorLink() {
  return (
    <Link className={styles.textLink} href="/auctions/account">
      View collector account
    </Link>
  );
}
