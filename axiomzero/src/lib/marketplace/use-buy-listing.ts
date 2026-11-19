"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { arbitrum } from "wagmi/chains";
import { toast } from "sonner";

import { sameAddress } from "@/lib/marketplace/trading-actions";
import type { Collection, MarketOffer } from "@/lib/marketplace/types";
import { marketplaceAbi } from "@/lib/web3/abis";
import { prepareContractWrite } from "@/lib/web3/transaction-preflight";

export type BuyListingBlockerKind =
  | "disconnected"
  | "wrong-chain"
  | "self-listing"
  | "missing-offer-id";

export type BuyListingBlocker = {
  kind: BuyListingBlockerKind;
  message: string;
};

const BLOCKER_MESSAGES: Record<BuyListingBlockerKind, string> = {
  disconnected: "Connect a wallet to activate trading controls.",
  "wrong-chain":
    "Switch to Arbitrum to trade through the marketplace contract.",
  "self-listing": "You cannot buy your own listing.",
  "missing-offer-id":
    "Buying is disabled because this listing did not include an offer ID.",
};

function blockerFor(kind: BuyListingBlockerKind): BuyListingBlocker {
  return { kind, message: BLOCKER_MESSAGES[kind] };
}

/**
 * Shared purchase flow for accepting an on-chain sell offer: wallet and
 * listing guards, chain switch, transaction preflight, the acceptSellOffer
 * write, receipt wait, and data refresh. Used by the token page and the
 * quick-buy dialog so there is exactly one buy implementation.
 */
export function useBuyListing({
  collection,
  offer,
  onSuccess,
}: {
  collection: Collection;
  /** The active sell offer; undefined while the token is unlisted. */
  offer?: MarketOffer;
  /** Runs after the purchase confirms, before the router refresh. */
  onSuccess?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);

  const blocker: BuyListingBlocker | undefined = !isConnected
    ? blockerFor("disconnected")
    : chainId !== arbitrum.id
      ? blockerFor("wrong-chain")
      : offer && sameAddress(offer.maker, address)
        ? blockerFor("self-listing")
        : offer && !offer.offerId
          ? blockerFor("missing-offer-id")
          : undefined;

  async function switchToArbitrum() {
    await switchChainAsync({ chainId: arbitrum.id });
  }

  /** Runs the full purchase; resolves true when the transaction confirmed. */
  async function buy(): Promise<boolean> {
    try {
      setIsPending(true);

      if (!publicClient || !address) {
        throw new Error("Connect your wallet to continue.");
      }

      if (!offer?.offerId) {
        throw new Error("This listing is missing a live on-chain offer ID.");
      }

      if (sameAddress(offer.maker, address)) {
        throw new Error("You cannot buy your own listing.");
      }

      if (chainId !== arbitrum.id) {
        await switchChainAsync({ chainId: arbitrum.id });
      }

      const value = parseEther(String(offer.priceEth));
      const prepared = await prepareContractWrite({
        publicClient,
        account: address,
        address: collection.marketplaceAddress,
        abi: marketplaceAbi,
        functionName: "acceptSellOffer",
        args: [BigInt(offer.offerId)],
        value,
      });
      const hash = await writeContractAsync({
        address: collection.marketplaceAddress,
        abi: marketplaceAbi,
        functionName: "acceptSellOffer",
        args: [BigInt(offer.offerId)],
        value,
        ...prepared,
      });

      toast.success("Transaction submitted", { description: hash });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Transaction confirmed");
      await onSuccess?.();
      router.refresh();

      return true;
    } catch (error) {
      toast.error("Transaction failed", {
        description:
          error instanceof Error
            ? error.message
            : "Review your wallet and try again.",
      });

      return false;
    } finally {
      setIsPending(false);
    }
  }

  return { buy, isPending, blocker, switchToArbitrum };
}
