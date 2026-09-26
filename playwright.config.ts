import { defineConfig, devices } from "@playwright/test";

// Shared Phase 2 E2E suite (Batch B: Resources/Field/Design; Batch C:
// Finance/Sales/HR + copilot) -- runs against the REAL live PROJEXA site
// (https://projexa-ai.com), not a local dev server or mock. There is no
// local server to boot: PROJEXA's real data lives in compliance-tracker's
// live database via the VERIDIAN API bridge (see PHASE1_SEED_REPORT.md), so
// a local `next dev` instance would show nothing useful for this suite's
// purposes -- the whole point is exercising the real deployed app against
// the real seeded "Meridian Construction Group (E2E Test Org)" data.
// Override PLAYWRIGHT_BASE_URL to point a one-off run at a different
// environment without changing this default.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Real live external site -- keep worker count low to avoid hammering it
  // and to keep test output easy to read as a real transcript.
  workers: 3,
  // "./playwright/redacted-reporter.ts" MUST be first: it redacts
  // cookie/authorization header values out of every TestError's
  // message/stack (and patches process.stdout/stderr directly as a
  // backstop) before the reporters after it ever print anything -- see
  // that file's own header comment for why (a real, live credential leak
  // via Playwright's own "Call log" formatting, printed into these PUBLIC
  // repos' world-readable CI job logs).
  reporter: process.env.CI
    ? [["./playwright/redacted-reporter.ts"], ["github"], ["list"]]
    : [["./playwright/redacted-reporter.ts"], ["list"], ["json", { outputFile: "e2e-results.json" }]],
  // Copilot Discuss tests wait up to 60s for a real LLM round-trip under
  // concurrent load; Batch B's proxy-through-VERIDIAN round trips were also
  // observed needing headroom under real (if elevated) load -- give every
  // test enough headroom for that plus setup.
  timeout: 75_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://projexa-ai.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
    // GAP FOUND (2026-09-19, Playwright gap-closure Round 2): Playwright's
    // own actionTimeout also governs page.request.*() API calls (not just
    // UI actions), and 15s was too tight for this app's own documented
    // local-dev-only overhead (CLAUDE.md's "Next.js dev-server on-demand
    // compilation costs ~6s on a route's first hit" note) compounding with
    // ordinary CPU/RAM contention on this machine -- server-side timing logs
    // showed the SAME route's `proxy.ts` phase (Next's own dev-mode request
    // handling, not this app's route logic, which stayed under 2.3s every
    // time) spiking to 14-18s under load while genuinely returning 200/201.
    // Raised to match navigationTimeout (already 30s, already proven
    // sufficient for this exact class of slowdown) rather than leaving the
    // two timeouts inconsistent for no reason.
    actionTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Each spec file selects its own logged-in user via
      // test.use({ storageState: "playwright/.auth/<key>.json" }) at the
      // top of the file -- see e2e/users.ts for which seeded user owns
      // which module.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // PROJEXA-BUILD-001 U-33: the two browser-first BOQ specs run only through playwright.boq-local.config.ts (a local server, a
      // synthetic signed-in browser, stubbed network). Here they would sit behind this project's real logins against production.
      testIgnore: [/auth\.setup\.ts/, /public-pages-perf\.spec\.ts/, /landing\.spec\.ts/, /boq-offline\.spec\.ts/, /boq-worker-filter\.spec\.ts/],
    },
    {
      // R67 J-01/J-02/J-03 (audit R-246/R-279/R-280). The public marketing
      // pages are measured logged OUT, so this project deliberately has NO
      // `dependencies: ["setup"]`: auth.setup.ts logs four seeded users in
      // against the REAL site, and pointing the run at a local build would
      // fail all four before a single timing assertion ran. The spec skips
      // itself unless PLAYWRIGHT_BASE_URL names a local origin.
      //     PLAYWRIGHT_BASE_URL=http://localhost:3100 \
      //       bunx playwright test --project=public-pages
      //
      // S12.A.A4 (W-WEB): e2e/landing.spec.ts joined this project rather than
      // "chromium" for the same reason -- it exercises the logged-out home
      // page and its lead-capture form, so it must not depend on
      // auth.setup.ts's real login against production.
      name: "public-pages",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [/public-pages-perf\.spec\.ts/, /landing\.spec\.ts/],
    },
  ],
});
