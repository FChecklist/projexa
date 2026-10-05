import { defineConfig } from "@playwright/test";
import base from "./playwright.local-first.config";

// AUDIT-100 B60: e2e/lf-static-host.spec.ts -- PROJEXA's static files served by a SEPARATE static host (the free Cloudflare Pages
// project of ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md), switched on by NEXT_PUBLIC_PX_STATIC_BASE.
//
//   bunx playwright test -c playwright.static-host.config.ts
//
// Same ground rules as playwright.local-first.config.ts (a production build, the local Auth stand-in, the sync service answered in the
// browser, nothing real reached), plus: the build is made WITH the switch pointing at e2e/support/static-host-server.mjs on its own port
// (127.0.0.1, a different origin from the app on localhost), and the release is staged for it by scripts/stage-static-pages.mjs, the
// same script that stages the real Pages upload.
const APP_PORT = Number(process.env.BOQ_LOCAL_PORT ?? 3117);
const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399);
const VERIDIAN_PORT = Number(process.env.LF_VERIDIAN_PORT ?? 54398);
export const STATIC_PORT = Number(process.env.STATIC_HOST_PORT ?? 3198);
export const STATIC_ORIGIN = `http://127.0.0.1:${STATIC_PORT}`;
const bundlerFlag = process.env.LF_LOCAL_BUNDLER === "webpack" ? " --webpack" : "";
const nextBin = "node node_modules/next/dist/bin/next";

export default defineConfig({
  ...base,
  testMatch: [/lf-static-host\.spec\.ts/],
  webServer: [
    {
      command: "node e2e/support/fake-supabase-server.mjs",
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_SUPABASE_PORT: String(STUB_PORT) },
    },
    {
      command: "node e2e/support/fake-veridian-server.mjs",
      url: `http://localhost:${VERIDIAN_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_VERIDIAN_PORT: String(VERIDIAN_PORT), FAKE_VERIDIAN_KEY: "local-stub-veridian-key" },
    },
    {
      // serves .static-pages lazily (per request), so it may start before the build below has staged it
      command: "node e2e/support/static-host-server.mjs",
      url: `${STATIC_ORIGIN}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { STATIC_HOST_PORT: String(STATIC_PORT), STATIC_HOST_DIR: ".static-pages" },
    },
    {
      command: `${nextBin} build${bundlerFlag} && node scripts/make-release.mjs && node scripts/stage-static-pages.mjs --out .static-pages && ${nextBin} start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      reuseExistingServer: false,
      timeout: 900_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-stub-anon-key",
        DATABASE_URL: "postgresql://postgres:placeholder@localhost:5432/postgres",
        BUILD_NUMBER: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        VERIDIAN_API_BASE_URL: `http://localhost:${VERIDIAN_PORT}`,
        VERIDIAN_API_KEY: "local-stub-veridian-key",
        NEXT_PUBLIC_PX_STATIC_BASE: STATIC_ORIGIN,
      },
    },
  ],
});
