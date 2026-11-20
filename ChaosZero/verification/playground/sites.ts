import { axiomUrl, chaosUrl, deployment } from "./deployment";

const localApi = new URL(deployment.apiUrl ?? deployment.cosmicUrl).origin;

export const sites: { kind: string; port: string; url: string; env: Record<string, string> }[] = [
  {
    kind: "chaos",
    port: new URL(chaosUrl).port,
    url: chaosUrl,
    env: {
      NEXT_PUBLIC_CHAIN_ID: "31337",
      NEXT_PUBLIC_RPC_URL: deployment.rpcUrl,
      NEXT_PUBLIC_MARKET_ADDRESS: "",
      NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS: deployment.previousMarket,
      NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS: deployment.market,
      NEXT_PUBLIC_LOCAL_SIMULATOR: "0",
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
    },
  },
  {
    kind: "axiom",
    port: new URL(axiomUrl).port,
    url: axiomUrl + "/auctions",
    env: {
      NEXT_PUBLIC_AUCTION_CHAIN_ID: "31337",
      NEXT_PUBLIC_AUCTION_ADDRESS: deployment.auction,
      NEXT_PUBLIC_AUCTION_CODE_HASH: deployment.auctionCodeHash,
      NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK: String(deployment.auctionDeploymentBlock),
      NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS: deployment.game,
      NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS: deployment.nft,
      NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL: deployment.rpcUrl,
      COSMIC_SIGNATURE_API_URLS: localApi,
      NEXT_PUBLIC_COSMIC_SIGNATURE_API_URLS: localApi,
      RANDOM_WALK_API_URLS: localApi,
      NEXT_PUBLIC_RANDOM_WALK_API_URLS: localApi,
      ARBITRUM_RPC_URLS: deployment.rpcUrl,
      NEXT_PUBLIC_ARBITRUM_RPC_URLS: deployment.rpcUrl,
    },
  },
];
