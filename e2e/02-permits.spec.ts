import { test, expect } from "@playwright/test";
import { apiGet, gotoAndCapture, DEFAULT_PROJECT } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// STALE-TEST FIX (2026-09-08): this spec was written against an EARLIER
// Permits screen -- org-wide (no project), backed by VERIDIAN's generic
// `documents` table filtered to category='permit', with an in-page "expiring
// within" window Select (30/60/90/365) and no write controls. None of that
// is still true.
//
// Priority 13 made Permits a first-class VERIDIAN entity (api/permits/
// route.ts:9-18's own header: "the Bearer-key-reachable twin of VERIDIAN's
// own ... /api/documents?category=permit" -- i.e. permits moved OFF the
// documents table onto its own). permits/page.tsx now resolves a PROJECT the
// same way /scope, /materials and /drawings do (resolveProjectForModule(),
// module-list-source.ts) -- it is project-scoped, not org-wide.
//
// The default view (no ?withinDays=) is ALL permits for the project --
// module-list-source.ts:352-356's fetchPermitsList() calls
// `/permits?projectId=...&all=true` -- there is no "default window" of any
// kind. There is also no in-page Select anywhere in PermitsListClient.tsx:
// grepping the whole src tree for "expiring within"/"Next 90 days" finds it
// ONLY in unrelated Dashboard/composer-card files. The one window this screen
// ever shows is a FIXED ?withinDays=30 deep link from the Dashboard's
// "Permits expiring" KPI tile (DashboardProjectClient.tsx:598,
// module-catalogue.ts:120's "permits.expiring" leaf action) -- there is no
// 30/60/90/365 choice anywhere. PermitsListClient.tsx:255's own filterAction
// is a disabled affordance that says so: "No filters on this list yet — the
// expiring-soon view is reached from the Dashboard."
//
// And it is no longer read-only: PermitsListClient.tsx:237's header "+ New"
// (ScreenFrame's newAction) pushes to /permits/new?projectId=..., a dedicated
// page (permits/new/page.tsx -> PermitCreateClient.tsx), not a modal --
// matching this app's chain-sentence Project > Module > New <thing> pattern
// (04-vendors.spec.ts documents the identical finding for /vendors/new).
test.describe("permits", () => {
  test("renders the real permit list for the default project (all permits, no window)", async ({ page }) => {
    // The server component prefetches this EXACT url (module-list-source.ts:354)
    // and seeds it as PermitsListClient's `initial` prop; use-list-read.ts's
    // seededUrl ref then SKIPS the client's own fetch on first paint (that is
    // F-18's whole point). gotoAndCapture()/waitForResponse would hang here --
    // pre-fetching independently, the original test's own pattern, is the only
    // way to know the real row count.
    const api = await apiGet<{ permits: unknown[] }>(
      page,
      `/api/permits?projectId=${DEFAULT_PROJECT.id}&all=true`
    );

    await page.goto(`/permits?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();

    // Stale: there is no window Select to default to "90" (see describe
    // comment) -- the frame's Filter action is a permanently disabled
    // affordance instead (PermitsListClient.tsx:255).
    await expect(page.getByRole("button", { name: "Filter" })).toBeDisabled();

    if (api.permits.length === 0) {
      // Stale: the old empty sentence was "No permits expiring in this
      // window." PermitsListClient.tsx:308/326 says this instead now,
      // regardless of whether a window filter is even in play.
      await expect(page.getByText("No permits yet for this project.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(api.permits.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `/api/permits?projectId=${DEFAULT_PROJECT.id}&all=true returned ${api.permits.length} rows for the default project. Permits is now its own VERIDIAN entity (Priority 13), not the org-wide 'documents' table -- the earlier "0 permit-category documents" finding this annotation used to report no longer applies to this module.`,
    });
  });

  test("a Dashboard 'expiring soon' deep link filters the list, and 'Show all' clears it (real re-fetch)", async ({ page }) => {
    // Stale: no in-page Select to cycle through 30/60/90/365 (see describe
    // comment) -- the ONLY window this screen shows is the fixed
    // ?withinDays=30 the Dashboard's KPI links to. A filtered arrival is NOT
    // server-seeded -- permits/page.tsx:57 hands the client `initial: null`
    // whenever `withinDays` is set, so use-list-read.ts's seededUrl check
    // never matches and the client always makes a real fetch here;
    // gotoAndCapture()'s waitForResponse is the correct tool.
    const filtered = await gotoAndCapture<{ permits: unknown[] }>(
      page,
      `/permits?projectId=${DEFAULT_PROJECT.id}&withinDays=30`,
      "/api/permits?"
    );
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();
    // PermitsListClient.tsx:268's headerMessageStrip banner, not a Select value.
    await expect(page.getByText("Showing permits expiring within 30 days")).toBeVisible();

    if (filtered.permits.length === 0) {
      await expect(page.getByText("No permits yet for this project.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(filtered.permits.length);
    }

    // "Show all" (PermitsListClient.tsx:271-278) drops the parameter
    // client-side. This is not the first url the hook instance ever saw, so
    // use-list-read.ts's seededUrl skip never applies and a real fetch fires
    // again -- confirmed by reading use-list-read.ts's effect directly, not
    // assumed from its comments.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/permits?projectId=${DEFAULT_PROJECT.id}&all=true`) && r.request().method() === "GET"
      ),
      page.getByRole("button", { name: "Show all" }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    const all = (await response.json()) as { permits: unknown[] };
    await expect(page.getByText("Showing permits expiring within 30 days")).toHaveCount(0);
    if (all.permits.length === 0) {
      await expect(page.getByText("No permits yet for this project.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(all.permits.length);
    }
  });

  test("has a real write control: 'New' opens a dedicated page, not a modal", async ({ page }) => {
    await page.goto(`/permits?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();

    // Stale: this used to assert NO button matching /^(new|add|create)/i
    // existed. PermitsListClient.tsx:237's header action ("+ New", drawn by
    // the shared kit's ScreenFrame -- newAction) is real and enabled.
    // .first(): an EMPTY project additionally renders a same-labelled
    // emptyAction button (PermitsListClient.tsx:310-312) alongside it.
    const newButton = page.getByRole("button", { name: "New" }).first();
    await expect(newButton).toBeVisible();
    await expect(newButton).toBeEnabled();

    await newButton.click();
    // Stale mechanism: a dedicated route, not a modal -- same chain-sentence
    // pattern 04-vendors.spec.ts documents for /vendors/new
    // (permits/new/page.tsx -> PermitCreateClient.tsx, ObjectScreen title
    // "New Permit").
    await expect(page).toHaveURL(new RegExp(`/permits/new\\?projectId=${DEFAULT_PROJECT.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "New Permit" })).toBeVisible();
  });
});
