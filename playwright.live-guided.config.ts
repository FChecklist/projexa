import { defineConfig, devices } from "@playwright/test";
// Live run of every guided spec (g1-g3 and g4 sign-in/session) against the deployed site. Audit use only.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/auth\.setup\.ts/, /guided-g[123]-.*\.spec\.ts/, /guided-g4-(sign-in|session)\.spec\.ts/],
  fullyParallel: false, retries: 1, workers: 1, reporter: [["list"]], timeout: 420_000, expect: { timeout: 30_000 },
  outputDir: "C:/ct/px-guided-results",
  use: { baseURL: process.env.AUDIT37_BASE_URL ?? "https://projexa-ai.com", trace: "retain-on-failure", screenshot: "only-on-failure", navigationTimeout: 90_000, actionTimeout: 30_000, serviceWorkers: "allow" },
  projects: [{ name: "setup", testMatch: /auth\.setup\.ts/ }, { name: "live-guided", use: { ...devices["Desktop Chrome"] } }],
});
