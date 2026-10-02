import { defineConfig, devices } from "@playwright/test";

// LOCAL-FIRST (R1, R2, R9, R10): the config for e2e/offline-local-first.spec.ts -- the app running from the laptop's own copy with the
// network OFF, and with our server down.
//
//   bunx playwright test -c playwright.local-first.config.ts
//
// It is NOT playwright.config.ts (that one logs four seeded users in against the real projexa-ai.com) and NOT playwright.boq-local.config.ts
// (that one runs `next dev`). Offline needs a PRODUCTION build: the service worker is deliberately never registered by `next dev`
// (src/components/ServiceWorkerRegister.tsx), and the release bundle (public/_release) is produced by the build. So this config:
//   1. starts e2e/support/fake-supabase-server.mjs, the same local Auth stand-in the BOQ specs use, so a synthetic signed-in browser is
//      accepted with no real session, project or secret;
//   2. builds PROJEXA with the stand-in's address inlined (NEXT_PUBLIC_* are fixed at build time), makes the release bundle
//      (`node scripts/make-release.mjs`, which `bun run build` runs as `postbuild` but `next build` alone does not), and starts it with `next start`.
// The sync service (a Supabase Edge Function) and every /api call of the page are answered inside the browser by the spec through page.route.
// Nothing reaches Vercel or any real network. Every value below is a placeholder, not a credential.
//
// It reuses the BOQ specs' port variables (BOQ_LOCAL_PORT, BOQ_LOCAL_SUPABASE_PORT) because e2e/support/boq-local.ts reads them for the cookie
// origin; run it on its own, not at the same time as playwright.boq-local.config.ts. LF_LOCAL_BUNDLER=webpack builds with `next build --webpack`
// (Turbopack refuses a node_modules folder that is a link to a folder outside the checkout, as in the development laptop's worktrees).
const APP_PORT = Number(process.env.BOQ_LOCAL_PORT ?? 3117);
const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399);
const bundlerFlag = process.env.LF_LOCAL_BUNDLER === "webpack" ? " --webpack" : "";
const nextBin = "node node_modules/next/dist/bin/next";

const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${STUB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-stub-anon-key",
  DATABASE_URL: "postgresql://postgres:placeholder@localhost:5432/postgres",
  BUILD_NUMBER: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/offline-local-first\.spec\.ts/, /lf-(ai|delivery|documents|overview|lifecycle)-.*\.spec\.ts/],  // lf-e10a/b/c, lf-e11, lf-e12 (the peer specs have their own config)
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 360_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
    // The worker is what serves the shell offline; it must be allowed (Playwright's default, written out because the whole spec depends on it).
    serviceWorkers: "allow",
  },
  projects: [{ name: "local-first", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/fake-supabase-server.mjs",
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_SUPABASE_PORT: String(STUB_PORT) },
    },
    {
      command: `${nextBin} build${bundlerFlag} && node scripts/make-release.mjs && ${nextBin} start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      reuseExistingServer: false,
      timeout: 900_000,
      env: appEnv,
    },
  ],
});
