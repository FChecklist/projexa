import { defineConfig, devices } from "@playwright/test";

// LOCAL-FIRST PEERS: the self-contained peer specs (e2e/peer-sync.spec.ts and e2e/lf-peer-*.spec.ts). Unlike playwright.config.ts, it has
// NO "setup" project (which signs in to the live site) and no baseURL: each spec serves its own page through page.route and needs no
// network at all.
//   bunx playwright test -c playwright.peer.config.ts
// PX_CHROMIUM_PATH lets a machine with a pre-installed Chromium use it instead of downloading Playwright's.
//
// WebRTC over loopback (lf-e9): Chromium hides a host ICE candidate's real address behind a random `<uuid>.local` mDNS name. Between two
// real laptops on one LAN that name resolves over multicast DNS; in a CI container (no mDNS responder) it never resolves, so no
// candidate pair ever connects and the data channel never opens. The app is not at fault (a real laptop pair resolves it, and STUN adds
// reflexive candidates besides), so the test browser alone is told to expose plain host candidates.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [/peer-sync\.spec\.ts/, /lf-peer-.*\.spec\.ts/],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [
    {
      name: "peer-sync",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
          ...(process.env.PX_CHROMIUM_PATH ? { executablePath: process.env.PX_CHROMIUM_PATH } : {}),
        },
      },
    },
  ],
});
