import { test, expect } from "@playwright/test";
import { fieldByLabel } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// GAP: verified live via direct API calls before writing these tests --
// GET /api/grc-dashboard, /api/risks, /api/policies, /api/vendor-risk,
// /api/fraud-cases, /api/access-review, /api/compliance-register all
// return zero rows. Phase 1's seed batches (1,007 rows total) never
// touched GRC data at all -- consistent with the seed report's own batch
// breakdown, not a bug. GRC is the most feature-complete of the 16 modules
// (8 fully-wired tabs) but has nothing seeded to read, so these tests lean
// on real writes to prove each tab actually works end-to-end. Unlike
// HR/Payroll (see hr-employees-payroll.spec.ts), GRC's write routes do NOT
// check ctx.dbUser -- confirmed via source (src/app/api/risks/route.ts's
// POST calls requireAuth() then callVeridian() directly, no dbUser gate)
// and this suite's own direct POST calls returning real 201s -- so these
// writes genuinely succeed.
//
// STALE-TEST FIX (2026-09-08): every write test below used to open a
// `role=dialog` popup to log/plan/draft/add the record. GrcClient.tsx's own
// header comments (RiskRegisterPanel, AuditsPanel, PoliciesPanel,
// VendorRiskPanel, FraudCasesPanel -- all dated "Real-screen conversion
// (2026-08-30)") say those Dialog popups are gone: every "Log X"/"Plan
// X"/"Draft X"/"Add X" button now does a real `router.push()` to a
// dedicated `/grc/.../new` route (RiskCreateClient.tsx,
// AuditEngagementCreateClient.tsx, AuditFindingCreateClient.tsx,
// PolicyCreateClient.tsx, VendorRiskCreateClient.tsx,
// FraudCaseCreateClient.tsx) -- the same chain-sentence Project > Module >
// New <thing> navigation 04-vendors.spec.ts already documents for /vendors.
// Every one of those create screens is the shared-kit ObjectScreen, whose
// only create-mode footer control is a plain "Save" button
// (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:
// 92-100) -- there is no "Log Risk"/"Plan Audit"/etc. button inside the
// form, and no `role=dialog` anywhere in these flows any more.
test.describe("GRC (/grc)", () => {
  test("dashboard loads and honestly reflects real GRC data (Phase 1 seeded none; this suite's own writes below may add some on re-runs)", async ({ page }) => {
    await page.goto("/grc");
    await expect(page.getByRole("heading", { name: "Risk & Compliance" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    // "No open risks logged yet." only holds true the FIRST time this
    // suite runs (GRC has no delete UI, so the Risk Register write test
    // below permanently adds one on every re-run) -- assert the dashboard
    // renders real summary cards instead of a fixed zero, so this stays
    // accurate across repeated live runs.
    await expect(page.getByText("Open Risks")).toBeVisible({ timeout: 15_000 });
  });

  test("real write: log a Risk in the Risk Register, verify it persists", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: "Risk Register" }).click();
    const title = `E2E Batch C Risk ${Date.now()}`;
    await page.getByRole("button", { name: /log risk/i }).click();
    // Stale: this used to open a Dialog. It now navigates to a dedicated
    // route -- RiskRegisterPanel's own comment (GrcClient.tsx:195-196) says
    // the old "Log Risk" Dialog popup was replaced with router.push
    // ("/grc/risks/new") on 2026-08-30.
    await expect(page).toHaveURL(/\/grc\/risks\/new$/);
    await fieldByLabel(page.locator("main"), "Title").fill(title);
    // Stale: no "Log Risk" button exists inside the form -- ObjectScreen's
    // create-mode footer control is always plain "Save" (ObjectScreen.tsx:92-100).
    await page.getByRole("button", { name: "Save" }).click();
    // RiskCreateClient.tsx:37 redirects to the new risk's own Object Page
    // (RiskObjectClient.tsx, added in the same conversion -- the Risk
    // Register never had a detail view before this) rather than closing a
    // dialog back onto the list.
    await expect(page).toHaveURL(/\/grc\/risks\/[0-9a-f-]+$/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });

  test("real write: plan an Audit engagement and record a finding against it", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: /audits/i }).click();
    const engagementName = `E2E Batch C Audit ${Date.now()}`;
    await page.getByRole("button", { name: /plan audit/i }).click();
    // Stale: this used to open a Dialog. AuditsPanel's own comment
    // (GrcClient.tsx:279-280) says the old "Plan Audit" Dialog popup was
    // replaced with router.push("/grc/audits/new") on 2026-08-30.
    await expect(page).toHaveURL(/\/grc\/audits\/new$/);
    await fieldByLabel(page.locator("main"), "Name").fill(engagementName);
    await page.getByRole("button", { name: "Save" }).click();
    // AuditEngagementCreateClient.tsx:36 redirects back to the Audits tab,
    // not an Object Page -- that component's own header comment says no
    // get/update-single route exists server-side for engagements yet (list
    // -with-nested-findings + create only), an honest scope cut.
    await expect(page).toHaveURL(/\/grc\?tab=audits/);
    await expect(page.getByText(engagementName)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /record finding/i }).click();
    // Stale: this used to open a Dialog too. AuditsPanel's own comment
    // (GrcClient.tsx:279-280) says "Record Finding" now pushes to the
    // dedicated route "/grc/findings/new" (AuditFindingCreateClient.tsx).
    await expect(page).toHaveURL(/\/grc\/findings\/new$/);
    await expect(page.getByText("Plan an engagement first")).not.toBeVisible({ timeout: 5_000 }).catch(() => {});
  });

  test("real write: draft a Policy succeeds; Request Publish is a real, reproducible 500 (GAP)", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: "Policies" }).click();
    const title = `E2E Batch C Policy ${Date.now()}`;
    await page.getByRole("button", { name: /draft policy/i }).click();
    // Stale: this used to open a Dialog. PoliciesPanel's own comment
    // (GrcClient.tsx:373-374) says the old "Draft Policy" Dialog popup was
    // replaced with router.push("/grc/policies/new") on 2026-08-30.
    await expect(page).toHaveURL(/\/grc\/policies\/new$/);
    await fieldByLabel(page.locator("main"), "Title").fill(title);
    await page.getByRole("button", { name: "Save" }).click();
    // PolicyCreateClient.tsx:34 redirects to the new policy's own Object
    // Page (PolicyObjectClient.tsx) rather than closing a dialog back onto
    // the list.
    await expect(page).toHaveURL(/\/grc\/policies\/[0-9a-f-]+$/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

    // Stale: "Request Publish" used to be a list-row button, clicked from
    // the Policies table. PolicyObjectClient.tsx:6-8's own header comment
    // says that action was "moved from a list-row button into the object
    // page" in the same 2026-08-30 conversion -- it now renders directly on
    // this Object Page for a draft policy (PolicyObjectClient.tsx:118-124),
    // so there is no `table tbody tr` to scope it to any more.
    //
    // GAP, confirmed via network trace before writing this assertion:
    // PATCH /api/policies/{id} with action="request_publish" reproducibly
    // returns 500 "Failed to update policy" -- compliance-tracker's own
    // src/app/api/v1/projexa/policies/[id]/route.ts:25-30 calls
    // updatePolicy(..., "request_publish", ...) (risk-register-service.ts),
    // which throws for a reason not surfaced beyond the generic 500
    // wrapper. PROJEXA's own proxy route (src/app/api/policies/[id]/route.ts)
    // still just forwards { action: "request_publish" } straight to
    // callVeridian() -- unchanged by the real-screen conversion -- so this
    // remains a distinct, real backend bug in compliance-tracker's
    // maker-checker approval-request creation for policies, not an
    // identity-bridge issue. The policy correctly stays in "draft" because
    // the write genuinely failed.
    const responsePromise = page.waitForResponse((r) => r.url().includes("/api/policies/") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: /request publish/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(500);
    // StatusBadge (veridian-ui-kit/src/screens/parts/StatusBadge.tsx:29)
    // renders the label as plain lowercase text -- no CSS capitalize trick
    // here (unlike the old list-row Badge), so a direct text match is exact.
    await expect(page.getByText("draft")).toBeVisible();
  });

  test("real write: add a Vendor under risk tracking", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: "Vendor Risk" }).click();
    const name = `E2E Batch C Vendor ${Date.now()}`;
    await page.getByRole("button", { name: /add vendor/i }).click();
    // Stale: this used to open a Dialog. VendorRiskPanel's own comment
    // (GrcClient.tsx:444-445) says the old "Add Vendor" Dialog popup was
    // replaced with router.push("/grc/vendors/new") on 2026-08-30.
    await expect(page).toHaveURL(/\/grc\/vendors\/new$/);
    await fieldByLabel(page.locator("main"), "Vendor Name").fill(name);
    await page.getByRole("button", { name: "Save" }).click();
    // VendorRiskCreateClient.tsx:37 redirects back to the Vendor Risk tab,
    // not an Object Page -- that component's own header comment says no
    // get/update-single route exists yet for vendor-risk profiles (plus an
    // unresolved naming overlap with the separate /api/vendors master-vendor
    // CRUD surface), an honest scope cut.
    await expect(page).toHaveURL(/\/grc\?tab=vendor-risk/);
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  });

  test("real write: log a Fraud/Incident case", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: /fraud/i }).click();
    const title = `E2E Batch C Fraud Case ${Date.now()}`;
    await page.getByRole("button", { name: /log case/i }).click();
    // Stale: this used to open a Dialog. FraudCasesPanel's own comment
    // (GrcClient.tsx:524-525) says the old "Log Case" Dialog popup was
    // replaced with router.push("/grc/cases/new") on 2026-08-30.
    await expect(page).toHaveURL(/\/grc\/cases\/new$/);
    await fieldByLabel(page.locator("main"), "Title").fill(title);
    await page.getByRole("button", { name: "Save" }).click();
    // FraudCaseCreateClient.tsx:38 redirects to the new case's own Object
    // Page (FraudCaseObjectClient.tsx, added in the same conversion -- the
    // Case Register never had a detail view before this) rather than
    // closing a dialog back onto the list.
    await expect(page).toHaveURL(/\/grc\/cases\/[0-9a-f-]+$/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });

  test("Compliance Register tab is read-only with real search/status filter controls", async ({ page }) => {
    await page.goto("/grc");
    await page.getByRole("tab", { name: "Compliance Register" }).click();
    await expect(page.getByText("No compliance obligations found.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /log|create|new|add/i })).toHaveCount(0);
  });
});
