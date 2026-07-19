import { defineConfig, devices } from "@playwright/test";

// Phase 2 Batch C (Finance/Sales/HR + copilot) E2E suite -- runs against the
// REAL live PROJEXA site (https://projexa-ai.com), not a local dev server or
// mock. There is no local server to boot: PROJEXA's real data lives in
// compliance-tracker's live database via the VERIDIAN API bridge (see
// PHASE1_SEED_REPORT.md), so a local `next dev` instance would show nothing
// useful for this suite's purposes -- the whole point is exercising the real
// deployed app against the real seeded "Meridian Construction Group (E2E
// Test Org)" data.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Real live external site -- keep worker count low to avoid hammering it
  // and to keep test output easy to read as a real transcript.
  workers: 3,
  reporter: [["list"], ["json", { outputFile: "e2e-results.json" }]],
  // Copilot Discuss tests wait up to 60s for a real LLM round-trip under
  // concurrent load -- give every test enough headroom for that plus setup.
  timeout: 75_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "https://projexa-ai.com",
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
      // top of the file -- see e2e/users.ts for which of the 3 seeded
      // users owns which module.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
