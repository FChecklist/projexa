// Real-browser page-load measurement tool for PROJEXA.
//
// Owner directive 2026-08-17: "MEASURE FIRST, DO NOT GUESS" -- and forbids
// synthetic/isolated-component evidence (see AGENTS.md-adjacent task
// governance and the h-screen/@source incident where a hand-authored
// harness passed while the real composed app failed). This script measures
// the REAL composed app: it logs into the real deployed site (or a
// BASE_URL override, e.g. a local `next start` production server) via the
// real login form, using the real seeded E2E test account (see
// e2e/users.ts / PHASE1_SEED_REPORT.md), then loads a real authenticated
// route at 1440x900 in a real Chromium instance and reports concrete
// numbers: total JS/CSS transferred, per-chunk sizes, FCP, LCP, TBT (via
// PerformanceObserver longtask entries), and TTFB/DOMContentLoaded/load.
//
// Usage:
//   BASE_URL=http://localhost:3100 node scripts/measure-perf.mjs /dashboard
//   node scripts/measure-perf.mjs /schedule   # defaults to the live site
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "https://projexa-ai.com";
const EMAIL =
  process.env.E2E_EMAIL ?? "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "MeridianE2E2026!";
const TARGET_PATH = process.argv[2] ?? "/dashboard";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Install the longtask + LCP observers via an init script so they're
  // active from the very first byte of the MEASURED navigation, not just
  // from whenever our page.evaluate() call happens to run afterward.
  await page.addInitScript(() => {
    window.__perf = { longtasks: [], lcp: null };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perf.longtasks.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__perf.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
  });

  // --- Login (not measured) ---
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  // --- Track every response for the measured navigation ---
  const resources = [];
  page.on("response", async (res) => {
    try {
      const req = res.request();
      const url = req.url();
      const rt = req.resourceType();
      const headers = res.headers();
      const cl = headers["content-length"] ? parseInt(headers["content-length"], 10) : null;
      let bodySize = cl;
      if (bodySize == null) {
        try {
          bodySize = (await res.body()).length;
        } catch {
          bodySize = 0;
        }
      }
      resources.push({ url, type: rt, size: bodySize, status: res.status() });
    } catch {
      /* ignore */
    }
  });

  const navStart = Date.now();
  await page.goto(`${BASE}${TARGET_PATH}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3000); // let hydration / lazy chunks / long tasks settle
  const navEnd = Date.now();

  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const tbt = (window.__perf?.longtasks ?? []).reduce(
      (sum, d) => sum + Math.max(0, d - 50),
      0
    );
    return {
      ttfb: nav ? nav.responseStart : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      loadEvent: nav ? nav.loadEventEnd : null,
      fcp,
      lcp: window.__perf?.lcp ?? null,
      tbt,
      documentTransferSize: nav ? nav.transferSize : null,
    };
  });

  const jsResources = resources.filter(
    (r) => r.type === "script" || /\.js(\?|$)/.test(r.url.split("?")[0])
  );
  const cssResources = resources.filter(
    (r) => r.type === "stylesheet" || /\.css(\?|$)/.test(r.url.split("?")[0])
  );
  const totalJs = jsResources.reduce((a, r) => a + (r.size || 0), 0);
  const totalCss = cssResources.reduce((a, r) => a + (r.size || 0), 0);
  const totalTransfer = resources.reduce((a, r) => a + (r.size || 0), 0);

  console.log("=== TARGET ===", TARGET_PATH, "on", BASE);
  console.log("=== Wall clock nav (goto+3s settle) ms ===", navEnd - navStart);
  console.log("=== Web Vitals (ms) ===", JSON.stringify(vitals, null, 2));
  console.log("=== JS: count / totalBytes ===", jsResources.length, totalJs, `(${(totalJs / 1024).toFixed(1)} KB)`);
  console.log("=== CSS: count / totalBytes ===", cssResources.length, totalCss, `(${(totalCss / 1024).toFixed(1)} KB)`);
  console.log("=== TOTAL bytes (all resources) ===", totalTransfer, `(${(totalTransfer / 1024).toFixed(1)} KB)`);
  console.log("=== Top 25 JS chunks by size ===");
  jsResources
    .sort((a, b) => b.size - a.size)
    .slice(0, 25)
    .forEach((r) => console.log(`  ${(r.size / 1024).toFixed(1)}KB  ${r.url}`));
  console.log("=== CSS files ===");
  cssResources.forEach((r) => console.log(`  ${(r.size / 1024).toFixed(1)}KB  ${r.url}`));

  await browser.close();
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
