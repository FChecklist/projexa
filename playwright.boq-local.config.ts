import { defineConfig, devices } from "@playwright/test";

// PROJEXA-BUILD-001 U-33 (BR-420, BR-421). The config for the two browser-first BOQ specs, e2e/boq-offline.spec.ts and
// e2e/boq-worker-filter.spec.ts. It is NOT playwright.config.ts: that one logs in four seeded users against the real projexa-ai.com
// (its "setup" project) and targets production by default, and these specs must never do either.
//
//   bunx playwright test -c playwright.boq-local.config.ts e2e/boq-offline.spec.ts
//
// What it starts, on this machine only:
//   1. e2e/support/fake-supabase-server.mjs on BOQ_LOCAL_SUPABASE_PORT (default 54399): a stand-in for the Supabase Auth endpoints, so a
//      synthetic signed-in browser is accepted without any real session, project or network;
//   2. PROJEXA itself with `next dev` on BOQ_LOCAL_PORT (default 3117, not the 3100 a developer's own server uses), pointed at that
//      stand-in, with both browser-first switches ON. Its API calls never reach a server: the specs answer them in the browser.
// No Vercel deployment is created or contacted. Every value passed to the server below is a placeholder, not a credential.
//
// BOQ_LOCAL_BUNDLER=webpack starts the server with `next dev --webpack`: Turbopack refuses a node_modules folder that is a link to a
// folder outside the checkout, which is how the worktrees on the development laptop are set up.
const APP_PORT = Number(process.env.BOQ_LOCAL_PORT ?? 3117);
const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399);
const bundlerFlag = process.env.BOQ_LOCAL_BUNDLER === "webpack" ? " --webpack" : "";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/boq-offline\.spec\.ts/, /boq-worker-filter\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 240_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "boq-local", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/fake-supabase-server.mjs",
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_SUPABASE_PORT: String(STUB_PORT) },
    },
    {
      command: `node node_modules/next/dist/bin/next dev -p ${APP_PORT}${bundlerFlag}`,
      url: `http://localhost:${APP_PORT}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-stub-anon-key",
        DATABASE_URL: "postgresql://postgres:placeholder@localhost:5432/postgres",
        BUILD001_BOQ_READ_VIA_GATEWAY: "true",
        BUILD001_BOQ_BROWSER_FIRST: "true",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
