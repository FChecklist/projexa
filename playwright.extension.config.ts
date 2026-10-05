import { defineConfig } from "@playwright/test";

// AUDIT 100 (A36, B51, B52): the browser extension in extension/projexa-ai-link, loaded UNPACKED into a real Chromium and driven through its
// popup and content script by e2e/extension-ai-link.spec.ts.
//   bunx playwright test -c playwright.extension.config.ts
// Like the peer specs it needs no server, no login and no network: the spec launches its own persistent browser context (extensions only
// load into one) and answers the chat sites and the guide address itself through context.route. There is deliberately no `use.baseURL`
// and no webServer. PX_CHROMIUM_PATH is not used: the spec needs Playwright's own Chromium in new headless mode (channel "chromium").
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/extension-ai-link\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [{ name: "extension" }],
});
