import { chromium } from "@playwright/test";
import fs from "node:fs";

const CHROME = "/home/rajat/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome";
const BASE_URL = "https://projexa-smoky.vercel.app";
const OUT_DIR = "/tmp/ocid020-evidence";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ storageState: "playwright/.auth/finance.json" });
const page = await context.newPage();

await page.goto(BASE_URL + "/dashboard", { waitUntil: "load", timeout: 30000 });
await page.waitForLoadState("networkidle");
await page.screenshot({ path: OUT_DIR + "/copilot-01-dashboard.png" });

const textarea = page.locator("textarea");
await textarea.fill("Show me our overdue invoices");
await page.screenshot({ path: OUT_DIR + "/copilot-02-filled.png" });
await textarea.press("Enter");
await page.waitForTimeout(15000);
await page.screenshot({ path: OUT_DIR + "/copilot-03-after-send.png" });

// Dump the composer's DOM structure for inspection
const composerHtml = await page.evaluate(() => {
  const el = document.querySelector('[class*="composer" i], [class*="chat" i], [class*="copilot" i]');
  return el ? el.outerHTML.slice(0, 3000) : "NOT FOUND via class heuristic";
});
fs.writeFileSync(OUT_DIR + "/composer-dom.html", composerHtml);
console.log("Saved composer DOM snippet, length:", composerHtml.length);

await context.close();
await browser.close();
