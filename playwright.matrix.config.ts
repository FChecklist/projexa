import { defineConfig, devices } from "@playwright/test";

// Matrix browser subset (test/matrix-100-2026-10-08): the REAL login page in real Chromium against the LOCAL Auth stand-in only.
// `next dev` instead of a production build: this laptop has under 1 GB free, and the login page needs no release or service worker.
// Nothing here talks to a live service; the Auth URL is a localhost stub.
const APP_PORT = Number(process.env.MATRIX_APP_PORT ?? 3118);
const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399);

export default defineConfig({
  testDir: "./e2e",
  testMatch: [/matrix-100-browser\.spec\.ts/],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: `http://localhost:${APP_PORT}`, navigationTimeout: 120_000, actionTimeout: 20_000 },
  projects: [{ name: "matrix-desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/fake-supabase-server.mjs",
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
      env: { FAKE_SUPABASE_PORT: String(STUB_PORT) },
    },
    {
      command: `node node_modules/next/dist/bin/next dev -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      reuseExistingServer: true,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-stub-anon-key",
        DATABASE_URL: "postgresql://postgres:placeholder@localhost:5432/postgres",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: "--max-old-space-size=1536",
      },
    },
  ],
});
