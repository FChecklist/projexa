import { defineConfig, devices } from "@playwright/test";

// LOCAL-FIRST PEERS: the self-contained peer-sync spec only. Unlike playwright.config.ts, it has NO "setup" project (which signs
// in to the live site) and no baseURL: the spec serves its own page through page.route and needs no network at all.
//   bunx playwright test -c playwright.peer.config.ts
// PX_CHROMIUM_PATH lets a machine with a pre-installed Chromium use it instead of downloading Playwright's.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /peer-sync\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [
    {
      name: "peer-sync",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PX_CHROMIUM_PATH ? { executablePath: process.env.PX_CHROMIUM_PATH } : {},
      },
    },
  ],
});
