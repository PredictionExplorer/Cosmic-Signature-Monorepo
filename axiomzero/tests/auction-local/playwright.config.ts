import { defineConfig, devices } from "@playwright/test";
if (!process.env.AXIOM_AUCTION_TEST_SITE)
  throw new Error(
    "Use pnpm test:auction:local to create an isolated production site.",
  );
// The contract/quote property uses the deployed contracts and production TypeScript
// directly. Its standalone campaign does not need a browser, site build or external data.
const quotesOnly = process.env.AXIOM_AUCTION_QUOTES_ONLY === "1";
export default defineConfig({
  testDir: ".",
  testMatch: ["lifecycle.spec.ts", "presentation.spec.ts"],
  grep: quotesOnly ? /@contract-quote\b/ : undefined,
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4599",
    contextOptions: { reducedMotion: "reduce" },
    actionTimeout: 15000,
    trace: "retain-on-failure",
  },
  webServer: quotesOnly
    ? undefined
    : {
        cwd: process.env.AXIOM_AUCTION_TEST_SITE,
        command:
          "pnpm exec next build --webpack && pnpm exec next start --hostname 127.0.0.1 --port 4599",
        url: "http://127.0.0.1:4599/auctions",
        reuseExistingServer: false,
        timeout: 480000,
      },
});
