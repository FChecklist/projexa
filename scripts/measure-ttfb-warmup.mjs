// Diagnostic: is the ~3.2-3.9s TTFB on authenticated pages a cold-start
// artifact (warms up on repeat navigation) or a sustained per-request cost?
// Navigates to /dashboard 3x in the same session and prints doc-load time +
// response headers each time (looking for server-timing / cache headers).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "https://projexa-ai.com";
const EMAIL = "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com";
const PASSWORD = "MeridianE2E2026!";
const PATH = process.argv[2] ?? "/dashboard";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  for (let i = 0; i < 4; i++) {
    const start = Date.now();
    const resp = await page.goto(`${BASE}${PATH}`, { waitUntil: "load" });
    const dur = Date.now() - start;
    console.log(`--- run ${i} ${PATH} doc load ${dur}ms status=${resp.status()} ---`);
    console.log("headers:", JSON.stringify(resp.headers(), null, 2));
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
