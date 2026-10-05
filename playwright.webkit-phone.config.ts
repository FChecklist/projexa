import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.local-first.config";

// AUDIT-100 B25 (Safari) + B26 (phones): the SAME production build, local Auth stand-in and in-browser sync service as
// playwright.local-first.config.ts (read its header), run in other browser engines and device profiles:
//   webkit-desktop  Playwright's WebKit (Safari's engine, Desktop Safari profile)
//   iphone-13       Playwright's WebKit with the iPhone 13 profile (390 px, touch, mobile user agent)
//   pixel-5         Playwright's Chromium with the Pixel 5 profile (393 px, touch, Android user agent)
// HONEST LIMIT: Playwright's WebKit is Safari's engine, not Safari itself (no Safari app, no iOS storage policy such as the 7-day script-
// writable storage cap, no Add to Home Screen), and the phone profiles are EMULATION in a desktop browser (viewport, touch, user agent),
// not a real phone. A real iPhone / Android run is the owner's.
//
//   bunx playwright install webkit
//   bunx playwright test -c playwright.webkit-phone.config.ts
export default defineConfig({
  ...base,
  testMatch: [/lf-lifecycle-webkit-phone\.spec\.ts/],
  projects: [
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "iphone-13", use: { ...devices["iPhone 13"] } },
    { name: "pixel-5", use: { ...devices["Pixel 5"] } },
  ],
});
