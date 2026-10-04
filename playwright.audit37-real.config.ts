import { defineConfig, devices } from "@playwright/test";

// AUDIT 37 (2026-10-04): the REAL-BACKEND journey on one laptop -- production build of PROJEXA served by `next start`, talking to the REAL
// PROJEXA Supabase project (credentials come from this checkout's .env.local, nothing is stubbed, no fake Auth, no page.route sync service).
// Unlike playwright.local-first.config.ts (which proves the machinery against stand-ins), this proves a real seeded user can log in, get the
// install, work offline, and keep working with our side (Supabase) unreachable.
//
//   bunx playwright test -c playwright.audit37-real.config.ts
//
// Needs a production build (the service worker is never registered by `next dev`). On the 8GB development laptop build with
// NODE_OPTIONS=--max-old-space-size=6144 and nothing else heavy running. Test accounts: e2e/users.ts (the documented E2E test org).
const APP_PORT = Number(process.env.AUDIT37_PORT ?? 3118);
const bundlerFlag = process.env.LF_LOCAL_BUNDLER === "webpack" ? " --webpack" : "";
const nextBin = "node node_modules/next/dist/bin/next";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/audit37-real-.*\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 420_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    serviceWorkers: "allow",
  },
  projects: [{ name: "audit37-real", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // reuse a build that already exists (AUDIT37_SKIP_BUILD=1) so a re-run does not pay the multi-minute build again
    command: process.env.AUDIT37_SKIP_BUILD === "1"
      ? `${nextBin} start -p ${APP_PORT}`
      : `${nextBin} build${bundlerFlag} && node scripts/make-release.mjs && ${nextBin} start -p ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}/login`,
    reuseExistingServer: true,
    timeout: 1_200_000,
    env: { BUILD_NUMBER: "1", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=6144" },
  },
});
