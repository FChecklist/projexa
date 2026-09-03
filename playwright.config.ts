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
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"], ["json", { outputFile: "e2e-results.json" }]],
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
    actionTimeout: 15_000,
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
      testIgnore: [/auth\.setup\.ts/, /public-pages-perf\.spec\.ts/],
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
      name: "public-pages",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /public-pages-perf\.spec\.ts/,
    },
  ],
});
