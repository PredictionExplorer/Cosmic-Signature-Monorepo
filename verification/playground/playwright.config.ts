import { defineConfig, devices } from "@playwright/test";
import { axiomUrl, chaosUrl, deployment } from "./deployment";

const localApi = new URL(deployment.apiUrl ?? deployment.cosmicUrl).origin;

export default defineConfig({
  testDir: ".",
  testMatch: "protocol.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    contextOptions: { reducedMotion: "reduce", serviceWorkers: "block" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node site.mjs chaos " + new URL(chaosUrl).port,
      cwd: __dirname,
      url: chaosUrl,
      timeout: 180_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
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
      command: "node site.mjs axiom " + new URL(axiomUrl).port,
      cwd: __dirname,
      url: axiomUrl + "/auctions",
      timeout: 180_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
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
  ],
});
