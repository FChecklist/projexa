import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const CHROME = "/home/rajat/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://projexa-smoky.vercel.app";
const OUT_DIR = "/tmp/ocid020-evidence";
fs.mkdirSync(OUT_DIR, { recursive: true });

const USERS = {
  ceo: { email: "arjun.mehta@meridian-construction.e2e-test.projexa-ai.com", password: "MeridianE2E2026!" },
};

const userDataDir = fs.mkdtempSync("/tmp/ocid020-profile-");
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: true,
});
const page = await context.newPage();

try {
  console.log("Navigating to", BASE_URL + "/login");
  await page.goto(BASE_URL + "/login", { waitUntil: "load", timeout: 30000 });
  await page.screenshot({ path: path.join(OUT_DIR, "01-login-page.png") });

  const user = USERS.ceo;
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.screenshot({ path: path.join(OUT_DIR, "02-login-filled.png") });
  await page.locator('button[type="submit"]').click();

  try {
    await page.waitForURL("**/dashboard", { timeout: 20000 });
    console.log("LOGIN SUCCESS -- reached", page.url());
  } catch (e) {
    console.log("LOGIN DID NOT REACH /dashboard. Current URL:", page.url());
    console.log("Error:", e.message);
  }
  await page.screenshot({ path: path.join(OUT_DIR, "03-after-login.png"), fullPage: true });
} catch (e) {
  console.error("SCRIPT ERROR:", e);
} finally {
  await context.close();
}
