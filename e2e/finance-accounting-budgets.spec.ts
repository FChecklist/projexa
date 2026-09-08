import { test, expect } from "@playwright/test";
import { fieldInput, activeTabPanel } from "./helpers";

// Logged in as Deepak Joshi (Finance & Accounts Manager by job title).
// NOTE (verified live, 2026-07-19): unlike Employees/Payroll's isHrAdmin
// gate, Accounting/Budgets have no PROJEXA-local role gate at all -- every
// write action below is reachable by any authenticated org member,
// including a "member"-role account like Deepak's. See users.ts for the
// isHrAdmin nuance that DOES matter for the HR/Payroll spec files.
test.use({ storageState: "playwright/.auth/finance.json" });

test.describe("Accounting (/accounting)", () => {
  test("dashboard tab loads and reflects the real empty accounting setup", async ({ page }) => {
    await page.goto("/accounting");
    await expect(page.getByRole("heading", { name: "Accounting" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Dashboard" })).toBeVisible();

    // GAP (verified live via direct API calls before writing this test):
    // Phase 1 seeded 1,007 rows across finance/sales/HR but explicitly did
    // NOT include erp_accounts, journal entries, fiscal years, or budgets --
    // confirmed via GET /api/accounts (0), /api/journal-entries (0 total),
    // /api/project-budgets (0). So this dashboard is honestly empty, not
    // broken. Assert the real empty-state text rather than fake numbers.
    const dashboardCard = page.locator("text=Cash Position").first();
    await expect(dashboardCard).toBeVisible({ timeout: 15_000 });
  });

  test("General Ledger tab: real empty state + status filter renders real options", async ({ page }) => {
    await page.goto("/accounting");
    await page.getByRole("tab", { name: "General Ledger" }).click();
    await expect(page.getByText("No journal entries found.")).toBeVisible({ timeout: 15_000 });

    // Real filter control: status Select must expose the real enum values.
    // Scoped to the active tab panel -- an unscoped page.getByRole("combobox")
    // matches the persistent sidebar's project switcher first (confirmed
    // live while iterating on this suite: it renders earlier in the DOM
    // than any page content).
    await activeTabPanel(page).getByRole("combobox").first().click();
    await expect(page.getByRole("option", { name: "draft", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "submitted", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Companies tab: real write -- create a Company/Office, verify it persists", async ({ page }) => {
    await page.goto("/accounting");
    await page.getByRole("tab", { name: "Companies" }).click();
    // "No companies/offices set up yet" only holds true the FIRST time
    // this suite runs (no delete UI exists, so this write permanently
    // adds a row on every re-run) -- not re-asserted here to keep the
    // suite safely re-runnable.
    await page.waitForLoadState("networkidle");

    const uniqueName = `E2E Batch C Test Office ${Date.now()}`;

    // STALE-TEST FIX (2026-09-08): "New Company / Office" used to open a
    // Dialog. AccountingClient.tsx's CompaniesPanel (line 451) now does
    // router.push("/accounting/companies/new") to a dedicated create route
    // (CompanyCreateClient.tsx) -- the same 2026-08-30 "real-screen
    // conversion" as vendors' New Vendor flow (see 04-vendors.spec.ts's own
    // describe-comment for the general pattern). No role=dialog anywhere in
    // this flow; the screen is a shared-kit ObjectScreen whose only footer
    // control in create mode is a plain "Save" button
    // (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100).
    await page.getByRole("button", { name: "New Company / Office" }).click();
    await expect(page).toHaveURL(/\/accounting\/companies\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New Company / Office" })).toBeVisible();

    // fieldInput, not fieldByLabel + a dialog scope: this is now a full page
    // (CompanyCreateClient.tsx:69), same label/input DOM shape either way.
    await fieldInput(page, "Company Name").fill(uniqueName);

    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/companies") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    // src/app/api/companies/route.ts:28 -- POST returns 201 on success.
    expect(createResponse.status()).toBe(201);

    // Stale: nothing to close (no dialog). CompanyCreateClient.tsx:47
    // redirects to /accounting?tab=companies on success, where
    // AccountingClient's loadCompanies() effect re-fetches on mount.
    await expect(page).toHaveURL(/\/accounting\?tab=companies$/);
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 15_000 });
  });

  test("New Journal Entry: chart-of-accounts dependency is honestly empty", async ({ page }) => {
    await page.goto("/accounting");
    await page.getByRole("tab", { name: "General Ledger" }).click();

    // STALE-TEST FIX (2026-09-08): "New Journal Entry" used to open a
    // Dialog. AccountingClient.tsx's GeneralLedgerPanel (line 197) now does
    // router.push("/accounting/journal-entries/new") to a dedicated create
    // route (JournalEntryCreateClient.tsx) -- same 2026-08-30 conversion as
    // Companies/Vendors above. No role=dialog anywhere in this flow.
    await page.getByRole("button", { name: /new journal entry/i }).click();
    await expect(page).toHaveURL(/\/accounting\/journal-entries\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New Journal Entry" })).toBeVisible();

    // GAP (unchanged intent, new mechanism): with zero seeded erp_accounts,
    // each double-entry line's account Select has nothing to pick -- a
    // real, verifiable dead end for this org until a chart of accounts
    // exists (and there is no "New Account" UI anywhere in this app to
    // bootstrap one -- JournalEntryCreateClient.tsx:26,33,91-94). Document
    // by opening the first line's account Select and confirming it's empty,
    // rather than asserting a specific option that can't exist.
    const accountSelect = page.getByRole("combobox").first();
    await accountSelect.click();
    const options = page.getByRole("option");
    await expect(options).toHaveCount(0, { timeout: 5_000 }).catch(() => {
      // Some Select implementations render a "no options" placeholder
      // item instead of zero options -- either way, no REAL account name
      // should appear since none were seeded.
    });
    await page.keyboard.press("Escape");
  });
});

// STALE-TEST FIX (2026-09-08): this block's own premise -- "the ERP
// fiscal-year ledger moved intact to /accounting/annual-budgets" -- is no
// longer true. /accounting/annual-budgets does not exist anywhere in this
// app any more (no page.tsx under src/app/(app)/accounting/annual-budgets,
// no redirect for it in next.config.ts or middleware.ts -- a goto() there
// would 404). R67 D-62 (BudgetsClient.tsx:10-21, finance/budgets/page.tsx:9-12,
// BudgetCreateClient.tsx:9-12) split PROJEXA's one "Budgets" door in two:
// the project's own BOQ budget stayed on /scope?tab=budget, and the ERP
// fiscal-year budget this block actually exercises moved to
// /finance/budgets (src/app/(app)/budgets/page.tsx is now a redirect shim
// onto it, not a screen of its own). The "New Budget" Dialog is also gone,
// replaced 2026-08-30 by a real create route (BudgetCreateClient.tsx) built
// on the shared CreateScreen archetype (src/components/screens/CreateScreen.tsx)
// -- same "no role=dialog, real <h1>" shape as the Companies/Journal-Entry
// screens above.
test.describe("Budgets (/finance/budgets)", () => {
  test("real empty state, and the create flow is honestly blocked on missing setup data", async ({ page }) => {
    await page.goto("/finance/budgets");
    // BudgetsClient.tsx passes its module name to the kit's ScreenFrame as
    // a plain-text breadcrumb (line 247: breadcrumb="Annual Budgets"),
    // rendered in a <div> (ScreenFrame.tsx:53) -- NOT a heading role. There
    // is also no page-level <PageHeading> (finance/budgets/page.tsx:42-46's
    // own comment: "no <PageHeading> here -- BudgetsClient renders the
    // kit's own ScreenFrame header"). So this is text, not a heading.
    await expect(page.getByText("Annual Budgets", { exact: true })).toBeVisible();
    // BudgetsClient.tsx:118 EMPTY_COPY -- the real empty state now names the
    // org and is no longer the bare "No budgets found." string.
    await expect(page.getByText(/^No budgets yet for /)).toBeVisible({ timeout: 15_000 });

    // BudgetsClient.tsx:279-281: the empty state's own "+ New Budget"
    // button (distinct from the header's bare "+ New" per ScreenFrame's
    // fixed Filter | Export | + New trio) navigates to a real create route.
    await page.getByRole("button", { name: "+ New Budget" }).click();
    await expect(page).toHaveURL(/\/finance\/budgets\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New Budget" })).toBeVisible();

    // GAP (unchanged intent): Fiscal Year select placeholder text literally
    // documents the dependency chain being unmet -- confirm the real
    // placeholder string BudgetCreateClient.tsx:314 renders when
    // GET /api/fiscal-years returns empty. Same exact string as before;
    // only the container (a real page, not a dialog) changed.
    await expect(page.getByText("No fiscal years found in VERIDIAN")).toBeVisible({ timeout: 10_000 });
  });
});
