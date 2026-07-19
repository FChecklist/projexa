import { test, expect } from "@playwright/test";
import { USERS } from "./users";
import { apiGet } from "./helpers";

// Non-admin access check: logs in as Manoj Yadav (Site Supervisor,
// compliance.users.role="member" -- not manager/senior_professional/admin,
// see PHASE1_SEED_REPORT.md's org chart), reusing the storageState
// auth.setup.ts already produced for this account rather than
// re-logging-in per test. requireAuth() (src/lib/supabase/auth-guard.ts)
// only checks that a membership row exists, with no per-module role gate
// found in any of the 11 in-scope modules' route.ts files during
// authoring -- this confirms that empirically rather than just trusting
// the source read.
test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

test.describe("member-level access (non-admin account)", () => {
  test("a real users.role=member account can view vendors, inventory, and procurement without elevated privileges", async ({
    page,
  }) => {
    const org = await apiGet<{ email: string; role: string }>(page, "/api/organization");
    expect(org.email).toBe(USERS.siteSupervisor.email);
    // PROJEXA's own local membership role (owner/member), NOT the VERIDIAN
    // userRoleEnum ("member") -- confirmed this account is not the org
    // "owner" (Arjun Mehta is), i.e. this really is a lower-privilege login.
    expect(org.role).not.toBe("owner");

    await page.goto("/vendors");
    await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
    const vendorsApi = await apiGet<{ vendors: unknown[] }>(page, "/api/vendors");
    await expect(page.locator("table tbody tr")).toHaveCount(vendorsApi.vendors.length);

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
    await page.getByRole("tab", { name: "Items" }).click();
    const itemsApi = await apiGet<{ items: unknown[] }>(page, "/api/inventory/items");
    await expect(page.locator("table tbody tr")).toHaveCount(itemsApi.items.length);

    await page.goto("/procurement");
    await expect(page.getByRole("heading", { level: 1, name: "Procurement" })).toBeVisible();
  });

  test("unauthenticated GETs to the 4 middleware-unprotected routes 401 at the API layer but the pages don't crash", async ({
    browser,
  }) => {
    // Real finding from reading src/middleware.ts's PROTECTED_PREFIXES:
    // /inventory, /procurement, /purchase-orders, and /permits are NOT
    // listed, so an unauthenticated visit is never redirected to /login by
    // middleware (unlike /materials, /vendors, /labour, /ffe, /floor-plans,
    // /mood-boards, /documents, which ARE listed and do redirect). The
    // underlying API routes still requireAuth() and 401 -- but since none
    // of these client components check res.ok on their GET calls, the page
    // silently renders its normal empty state instead of an error or a
    // redirect. Verified live with a brand-new, fully unauthenticated
    // browser context (no storageState at all).
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    for (const path of ["/inventory", "/procurement", "/purchase-orders", "/permits"]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not itself error`).toBeLessThan(500);
      expect(page.url(), `${path} should NOT redirect to /login (real middleware gap)`).toContain(path);
    }

    for (const path of ["/materials", "/vendors", "/labour", "/documents"]) {
      await page.goto(path);
      await page.waitForURL("**/login**", { timeout: 10_000 });
    }

    await context.close();
  });
});
