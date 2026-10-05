import { defineConfig, devices } from "@playwright/test";

// AUDIT-100 B1 / B16: read-only smoke of the DEPLOYED site, no login, nothing started locally and nothing deployed.
//   bunx playwright test -c playwright.live-smoke.config.ts
//   LIVE_URL=https://projexa-ai.com   (default)
//   EXPECT_SHA=<40-hex>               the commit the latest production deployment was built from (Vercel list, read-only); when set the
//                                     test requires the live /sw.js to be stamped with exactly that commit
// Not part of the pull-request CI: it needs the public internet and tests a deploy, not a change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/live-site-smoke\.spec\.ts/],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.LIVE_URL ?? "https://projexa-ai.com",
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "live-smoke", use: { ...devices["Desktop Chrome"] } }],
});
