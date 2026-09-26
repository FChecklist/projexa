import { defineConfig, devices } from "@playwright/test";

// PROJEXA-BUILD-002 WP-08 (AW-405). The config for the LIVE run of e2e/ai-link-mint.spec.ts: a PROJEXA server that is already running on this
// machine (bun run dev, port 3100, with its own .env.local for the real PROJEXA Supabase project) and the live Edge function ai-work-link.
// It starts nothing and is not playwright.config.ts: that one logs four seeded users in against production in its "setup" project.
//
//   AWL_E2E_MINT_SECRET=... PROJEXA_SUPABASE_ANON_KEY=... bunx playwright test -c playwright.ai-link-live.config.ts
//
// The two variables are read from the environment only and never printed. See the header of e2e/ai-link-mint.spec.ts for what the run does
// (one level 0 link, revoked before the test ends) and for the optional variables. No Vercel deployment is created or contacted.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/ai-link-mint\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "ai-link-live", use: { ...devices["Desktop Chrome"] } }],
});
