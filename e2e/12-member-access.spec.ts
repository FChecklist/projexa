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

  test("unauthenticated GETs to all 8 routes (formerly mixed gating) now redirect to /login", async ({
    browser,
  }) => {
    // STALE: this test used to assert /inventory, /procurement,
    // /purchase-orders, and /permits were NOT redirected to /login, citing
    // src/middleware.ts's old hand-written PROTECTED_PREFIXES array (which
    // didn't list them) as a "real middleware gap". That mechanism is gone.
    // R48_PAGE_AUTH_GATE_COVERS_HALF_THE_NAV_01 (src/lib/authz/page-access.ts:1-38)
    // replaced it with a deny-by-default gate: every page under
    // src/app/(app)/ requires authentication, full stop, no allow-list to
    // drift. page-access.test.ts:88-114 ("the specific routes the old
    // allow-list lost are now gated") names /inventory, /permits,
    // /procurement, and /purchase-orders explicitly as routes the old list
    // missed and this one closes -- so the documented "gap" is now the
    // thing under regression test on the source side. All 8 routes below
    // behave identically today: same redirect, same as /materials/
    // /vendors/ /labour/ /documents already did.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    for (const path of ["/inventory", "/procurement", "/purchase-orders", "/permits", "/materials", "/vendors", "/labour", "/documents"]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not itself error`).toBeLessThan(500);
      await page.waitForURL("**/login**", { timeout: 10_000 });
    }

    await context.close();
  });
});
