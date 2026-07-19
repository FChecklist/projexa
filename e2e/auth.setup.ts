import { test as setup, expect } from "@playwright/test";
import { USERS, type UserKey } from "./users";

// Logs in each of the 3 seeded users this batch needs via the REAL login
// form (src/app/login/page.tsx: #email/#password inputs, redirects to
// /dashboard on success) and saves the resulting Supabase session cookies
// to playwright/.auth/<key>.json, so the real spec files can start
// authenticated without re-running the login flow (and re-hitting
// Supabase's rate limits) for every single test.
async function loginAs(key: UserKey, page: import("@playwright/test").Page) {
  const user = USERS[key];
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  await expect(page).toHaveURL(/\/dashboard/);
}

setup("authenticate as CEO (Arjun Mehta)", async ({ page }) => {
  await loginAs("ceo", page);
  await page.context().storageState({ path: "playwright/.auth/ceo.json" });
});

setup("authenticate as Finance manager (Deepak Joshi)", async ({ page }) => {
  await loginAs("finance", page);
  await page.context().storageState({ path: "playwright/.auth/finance.json" });
});

setup("authenticate as HR administrator (Sneha Reddy)", async ({ page }) => {
  await loginAs("hr", page);
  await page.context().storageState({ path: "playwright/.auth/hr.json" });
});

setup("authenticate as Site Supervisor (Manoj Yadav)", async ({ page }) => {
  await loginAs("siteSupervisor", page);
  await page.context().storageState({ path: "playwright/.auth/siteSupervisor.json" });
});
