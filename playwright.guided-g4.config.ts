import { defineConfig, devices } from "@playwright/test";

// GUIDED ERRORS, group G4 (sign-in, sessions, invitations, 404/403, AI unavailable): real Chromium against a RUNNING PROJEXA.
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.guided-g4.config.ts
// guided-g4-sign-in needs no secret (Auth calls are answered in the browser); guided-g4-session signs in the documented E2E test users with a code from
// the Supabase admin API (test domain only, nothing e-mailed). The laptop-shell part (guided-g4-laptop) runs under playwright.local-first.config.ts.
// Not part of pull-request CI: it tests a deploy, not a change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/guided-g4-(sign-in|session)\.spec\.ts/],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com",
    trace: "retain-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    serviceWorkers: "allow",
  },
  projects: [{ name: "guided-g4", use: { ...devices["Desktop Chrome"] } }],
});
