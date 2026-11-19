import { defineConfig, devices } from "@playwright/test";
if (!process.env.AXIOM_AUCTION_TEST_SITE)
  throw new Error(
    "Use pnpm test:auction:local to create an isolated production site.",
  );
export default defineConfig({
  testDir: ".",
  testMatch: ["lifecycle.spec.ts", "presentation.spec.ts"],
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
  webServer: {
    cwd: process.env.AXIOM_AUCTION_TEST_SITE,
    command:
      "pnpm exec next build --webpack && pnpm exec next start --hostname 127.0.0.1 --port 4599",
    url: "http://127.0.0.1:4599/auctions",
    reuseExistingServer: false,
    timeout: 480000,
  },
});
