import { defineConfig, devices } from "@playwright/test";
import { sites } from "./sites";

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
  webServer: sites.map(({ kind, port, ...server }) => ({
    ...server,
    command: `node site.mjs ${kind} ${port}`,
    cwd: __dirname,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  })),
});
