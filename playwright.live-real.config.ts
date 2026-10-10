import { defineConfig, devices } from "@playwright/test";

// LIVE modes proof (2026-10-10): the real-backend offline / sync specs run against the DEPLOYED site (no local build, no local server).
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.live-real.config.ts [spec]
// Test users only (e2e/users.ts, documented E2E domain); the code comes from the Supabase admin API and no mail is sent.
// Not part of pull-request CI: it needs the public internet and tests a deploy, not a change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/audit37-real-(b17-b20-offline|b7-writeback|b8-kinds-deletes|peers)\.spec\.ts/],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 420_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com",
    trace: "retain-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    serviceWorkers: "allow",
    launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  projects: [{ name: "live-real", use: { ...devices["Desktop Chrome"] } }],
});
