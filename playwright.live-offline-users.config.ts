import { defineConfig, devices } from "@playwright/test";

// SUMEET 111 offline writers as a user (2026-10-13): the writers shipped in #444/#2143 plus the offline Reports, run against the DEPLOYED site.
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.live-offline-users.config.ts
// Test users only (e2e/users.ts, documented E2E domain); the sign-in code comes from the Supabase admin API and no mail is sent.
// Not part of pull-request CI: it needs the public internet and tests a deploy, not a change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/live-offline-writers-users\.spec\.ts/, /live-offline-round3-users\.spec\.ts/, /live-offline-screens-users\.spec\.ts/, /live-online-reports-users\.spec\.ts/, /live-online-demo-gate-users\.spec\.ts/, /live-online-progress-columns-users\.spec\.ts/, /live-offline-boq-rules-users\.spec\.ts/, /live-more-rules-users\.spec\.ts/],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 900_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com",
    trace: "retain-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    serviceWorkers: "allow",
    launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  projects: [{ name: "live-offline-users", use: { ...devices["Desktop Chrome"] } }],
});
