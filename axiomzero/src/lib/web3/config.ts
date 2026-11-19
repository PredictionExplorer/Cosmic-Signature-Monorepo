"use client";

import { createConfig, http } from "wagmi";
import { isLocalAuctionRpc } from "@/lib/auctions/config";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrum, arbitrumSepolia, foundry } from "wagmi/chains";

const WALLETCONNECT_PLACEHOLDER = "00000000000000000000000000000000";
export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || undefined;
export const isWalletConnectConfigured = Boolean(walletConnectProjectId);
export const walletConfigurationWarning =
  "Wallet connections require NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Browsing stays available, but wallet actions are disabled until it is configured.";

const wagmiProjectId = walletConnectProjectId ?? WALLETCONNECT_PLACEHOLDER;

const localRpc = process.env.NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL;
const localAuction =
  process.env.NEXT_PUBLIC_AUCTION_CHAIN_ID === "31337" &&
  isLocalAuctionRpc(localRpc);

export const wagmiConfig = localAuction
  ? createConfig({
      chains: [foundry],
      transports: { [foundry.id]: http(localRpc) },
      ssr: true,
    })
  : getDefaultConfig({
      appName: "Axiom Zero",
      projectId: wagmiProjectId,
      chains: [arbitrum, arbitrumSepolia],
      ssr: true,
    });
