import { defineConfig, devices } from "@playwright/test";

// GUIDED ERRORS, group G1 (projects, Scope of Work / BOQ, import, baseline, budget): the specs e2e/guided-g1-*.spec.ts, run through the REAL screens as
// the E2E Meridian test users. Against the live site (no local build, no local server):
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.guided.config.ts [spec]
// Test users only (e2e/users.ts, documented E2E domain); the sign-in code comes from the Supabase admin API and no mail is sent. Data made is labelled
// "AUDIT G1 <stamp>" and never deleted. Not part of pull-request CI: it needs the public internet and tests a deploy, not a change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/guided-g1-.*\.spec\.ts/],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com",
    trace: "retain-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "guided-g1", use: { ...devices["Desktop Chrome"] } }],
});
