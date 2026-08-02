import { chromium } from "@playwright/test";
import fs from "node:fs";

const CHROME = "/home/rajat/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome";
const BASE = "https://projexa-smoky.vercel.app";
const OUT = "/tmp/ocid020-evidence";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ storageState: "playwright/.auth/ceo.json" });
const page = await context.newPage();

async function shot(name, url) {
  await page.goto(BASE + url, { waitUntil: "load", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("shot:", name, page.url());
}

await shot("sweep-01-permits", "/permits");
await shot("sweep-02-documents", "/documents");
await shot("sweep-03-wiki", "/wiki");
await shot("sweep-04-knowledge-base", "/knowledge-base");

// Procurement requisition creation attempt with network capture
await page.goto(BASE + "/procurement", { waitUntil: "load" });
await page.waitForLoadState("networkidle").catch(() => {});
let reqResponse = null;
page.on("response", (res) => {
  if (res.url().includes("/api/procurement/requisitions") && res.request().method() === "POST") {
    reqResponse = { status: res.status(), url: res.url() };
  }
});
try {
  await page.getByRole("button", { name: /new requisition/i }).click({ timeout: 10000 });
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/sweep-05-requisition-dialog.png` });
} catch (e) {
  console.log("requisition dialog open failed:", e.message);
}
await page.screenshot({ path: `${OUT}/sweep-06-procurement-state.png` });

await browser.close();
console.log("Requisition POST captured:", JSON.stringify(reqResponse));
