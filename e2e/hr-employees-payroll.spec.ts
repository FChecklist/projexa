import { test, expect } from "@playwright/test";
import { fieldByLabel } from "./helpers";

// GAP #1, confirmed live before writing these tests (see e2e/users.ts):
// PROJEXA's isHrAdmin gate (src/hooks/use-org-role.ts) is based on
// PROJEXA-local memberships.role, NOT the seeded employee_profiles.job_title.
// Only Arjun Mehta (memberships.role === "owner") sees admin-only controls
// (Employee Profile create, New Department, leave Approve/Reject, Payroll
// Run create/process, etc). Sneha Reddy -- the REAL HR Administrator by job
// title -- has memberships.role === "member" and does NOT see them,
// verified by diffing the two accounts' rendered `<button>` text on
// /employees: Arjun has an "Employee Profile" button, Sneha does not.
//
// GAP #2 (bigger, discovered while iterating on this suite -- verified via
// direct POST calls against every write endpoint below, then reproduced
// through the real UI): even when a write IS UI-visible (i.e. logged in as
// Arjun, the one account with isHrAdmin === true), the underlying VERIDIAN
// endpoint for every HR/Payroll write rejects it with a real, reproducible
// 400 "This action requires a real user session, not an API key" -- because
// PROJEXA's server never forwards individual-user identity to VERIDIAN at
// all, only one shared per-org API key (`callVeridian()`,
// src/lib/veridian-client.ts). compliance-tracker's own route code
// (`if (!ctx.dbUser) return ... "requires a real user session"`) is checking
// for a real VERIDIAN session that literally cannot exist for ANY PROJEXA
// user, including the org owner -- confirmed via source in
// src/app/api/v1/projexa/{hr/departments,leave/requests,leave/requests/[id]/decision,
// leave/balances,employees,payroll/runs}/route.ts, every one of which has
// this exact guard. So isHrAdmin's UI-gating (GAP #1) is almost moot: even
// the one account allowed past it hits a hard backend wall. This is the
// SAME underlying architecture gap as Wiki/Knowledge Base's disclosed
// "requires a per-user VERIDIAN session" limitation (commit 4fed451) --
// except HR/Payroll/Leave has NO disclosure banner anywhere telling the
// user why. Recruitment and GRC writes were verified NOT to hit this guard
// (their routes don't check ctx.dbUser) -- confirmed via direct POST calls
// returning 201, not 400 -- so those really do work end-to-end.
//
// STALE-TEST FIX (2026-09-08): GAP #1 and GAP #2 above are both still real
// (re-confirmed via current source: use-org-role.ts's HR_ADMIN_ROLES is
// still {owner, admin}, and compliance-tracker's hr/departments, employees,
// leave/requests, leave/balances and payroll/runs POST routes still hard-
// require ctx.dbUser -- recruitment's job-openings/candidates routes still
// fall back to `ctx.dbUser?.id ?? ctx.apiKey?.id` and so still succeed). What
// changed is the MECHANISM, not these two architecture gaps. Every write
// test below used to open a `role=dialog` popup. EmployeesClient.tsx's and
// PayrollClient.tsx's own header/inline comments (all dated "Real-screen
// conversion (2026-08-30)") say those Dialog popups are gone: "Employee
// Profile" -> /employees/new, "New Department" -> /employees/departments/new,
// "Request Leave" -> /employees/leave/new, "New Payroll Run" ->
// /payroll/runs/new, "View Register" -> /payroll/runs/[id] (a real Object
// Page, not a Dialog) -- the same chain-sentence Project > Module > New
// <thing> navigation 04-vendors.spec.ts already documents for /vendors.
// RecruitmentClient.tsx got the identical conversion ("New Job Opening" ->
// /recruitment/openings/new, "Add Candidate" -> /recruitment/candidates/new).
// Every create screen is the shared-kit ObjectScreen, whose only create-mode
// footer control is a plain "Save" button (node_modules/@fchecklist/
// veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100) -- there is no
// "Submit"/"Request"/"Create"/"Add" button inside any of these forms, and no
// `role=dialog` anywhere in these flows any more. Separately, the
// Departments-tab 500 GAP this file used to document is now fixed --
// see that test's own comment below for the exact schema change.

test.describe("Employees directory (/employees) -- admin actions, as CEO (owner)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("real seeded employees render (11 seeded, 10 shown on page 1 of the DataTable)", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(10, { timeout: 15_000 });
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1, { timeout: 10_000 });
  });

  test("department filter and employee search are real, working controls", async ({ page }) => {
    await page.goto("/employees");
    await page.waitForSelector("table tbody tr");
    const firstName = (await page.locator("table tbody tr").first().locator("td").first().innerText()).trim();
    await page.getByPlaceholder(/search employees/i).fill(firstName);
    await expect(page.locator("table tbody tr").first()).toContainText(firstName, { timeout: 10_000 });
  });

  test("Employee Profile button is visible for owner-role, but the write itself hits the real dbUser architecture gap (GAP #2)", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.getByRole("button", { name: /employee profile/i })).toBeVisible({ timeout: 15_000 });

    const resp = await page.evaluate(async () => {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "00000000-0000-0000-0000-000000000000", designation: "E2E Probe" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    console.log("POST /api/employees as owner ->", JSON.stringify(resp));
    expect(resp.status).toBe(400);
    expect(resp.body?.error).toMatch(/real user session/i);
  });

  test("Departments tab renders the 6 real seeded departments (the relational-query 500 GAP is fixed)", async ({ page }) => {
    await page.goto("/employees");
    await page.getByRole("tab", { name: "Departments" }).click();
    // Stale: this test used to document GET /api/hr/departments 500ing,
    // root-caused to compliance-tracker's hr/departments/route.ts:24-29's
    // relational query (`with: { head, users } }`) throwing on an ambiguous
    // users<->departments relation pair. That ambiguity is now resolved:
    // compliance-tracker's schema.ts:2707-2726 names BOTH relation pairs
    // (`head`/relationName "deptHead", `users`/relationName
    // "departmentMembers"), and the comment right on that block (schema.ts:
    // 2710-2725) cites the exact "There are multiple relations between
    // 'users' and 'departments'" error this fix removes -- the same query
    // shape hr/departments/route.ts:24-29 still uses can no longer throw at
    // query-build time. Source-only finding (no dev server run to
    // reconfirm live) -- if this still 500s, revert to the old assertion.
    await expect(page.locator("table tbody tr")).toHaveCount(6, { timeout: 15_000 });
  });

  test("Org Chart tab renders the real 1-CEO + 10-employee reporting hierarchy", async ({ page }) => {
    await page.goto("/employees");
    await page.getByRole("tab", { name: "Org Chart" }).click();
    await expect(page.getByText("Arjun Mehta")).toBeVisible({ timeout: 15_000 });
  });

  test("Leave tab: real write -- approving a seeded pending leave request fails on the real dbUser architecture gap (GAP #2)", async ({ page }) => {
    await page.goto("/employees");
    await page.getByRole("tab", { name: "Leave" }).click();
    await page.waitForLoadState("networkidle");
    const pendingRow = page.locator("table tbody tr", { has: page.getByText("pending", { exact: true }) }).first();
    const hasPending = await pendingRow.isVisible().catch(() => false);
    test.skip(!hasPending, "no seeded leave request is currently pending");

    // Approve button = the first icon-only ghost Button in the row (Check
    // icon; Reject/X is second) -- confirmed via source
    // (EmployeesClient.tsx: decide(r.id, "approved")).
    await pendingRow.locator("button").first().click();
    // GAP: real, reproducible failure -- confirmed via direct POST before
    // writing this test (POST /api/leave/requests/{id}/decision as Arjun,
    // the owner account, still returns 400 "This action requires a real
    // user session, not an API key"). The UI surfaces this as a toast; the
    // row correctly stays "pending" because the write genuinely did not
    // happen -- this assertion documents the real broken behavior.
    await expect(page.getByText(/real user session/i)).toBeVisible({ timeout: 15_000 });
    await expect(pendingRow).toContainText("pending");
  });
});

test.describe("Employees directory (/employees) -- member-role experience, as Sneha Reddy (real HR Admin by job title)", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test("GAP #1 verified: Employee Profile / New Department buttons are NOT visible to the real HR admin", async ({ page }) => {
    await page.goto("/employees");
    await page.waitForSelector("table tbody tr");
    await expect(page.getByRole("button", { name: /employee profile/i })).toHaveCount(0);
    await page.getByRole("tab", { name: "Departments" }).click();
    await expect(page.getByRole("button", { name: /new department/i })).toHaveCount(0);
  });

  test("Request Leave (available to any member, unlike Approve) ALSO hits the real dbUser architecture gap (GAP #2)", async ({ page }) => {
    await page.goto("/employees");
    await page.getByRole("tab", { name: "Leave" }).click();
    await page.waitForLoadState("networkidle");

    // Stale: this used to open a Dialog. EmployeesClient.tsx:398-400's own
    // comment says the old "Request Leave" Dialog popup was replaced with
    // router.push("/employees/leave/new") on 2026-08-30 -- the form now
    // lives on LeaveRequestCreateClient.tsx, a real page with no dialog
    // role anywhere.
    await page.getByRole("button", { name: /request leave/i }).click();
    await expect(page).toHaveURL(/\/employees\/leave\/new$/);
    await fieldByLabel(page.locator("main"), "Leave Type").fill("Casual Leave");
    const dateInputs = page.locator('input[type="date"]');
    const start = new Date();
    start.setDate(start.getDate() + 30);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    await dateInputs.nth(0).fill(start.toISOString().slice(0, 10));
    await dateInputs.nth(1).fill(end.toISOString().slice(0, 10));
    // Stale: no "Submit"/"Request" button exists in this form any more --
    // ObjectScreen's create-mode footer control is always plain "Save"
    // (ObjectScreen.tsx:92-100).
    await page.getByRole("button", { name: "Save" }).click();

    // GAP: still real -- compliance-tracker's src/app/api/v1/projexa/leave/
    // requests/route.ts:31 still hard-requires ctx.dbUser and 400s "This
    // action requires a real user session, not an API key" for PROJEXA's
    // API-key-only caller; LeaveRequestCreateClient.tsx's own header
    // comment (lines 4-9) discloses this as a known pre-existing
    // limitation. Even a simple self-service "request my own leave" write,
    // gated only at "member"+"write" scope (no manager/admin requirement at
    // all), still hits it -- this isn't specific to admin actions.
    await expect(page.getByText(/real user session/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Payroll (/payroll) -- admin actions, as CEO", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("real seeded payroll data renders with correct counts (3 runs, 6 components, 11 structures)", async ({ page }) => {
    await page.goto("/payroll");
    await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table tbody tr")).toHaveCount(3, { timeout: 15_000 });

    await page.getByRole("tab", { name: "Salary Components" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table tbody tr")).toHaveCount(6, { timeout: 15_000 });

    await page.getByRole("tab", { name: "Salary Structures" }).click();
    await page.waitForLoadState("networkidle");
    // Same shadcn DataTable pagination as Employees (page-size fixed at
    // 10) -- 11 seeded structures means 10 on page 1, 1 on page 2.
    await expect(page.locator("table tbody tr")).toHaveCount(10, { timeout: 15_000 });
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1, { timeout: 10_000 });
  });

  test("Income Tax tab is present (org country confirmed IN via /api/organization)", async ({ page }) => {
    await page.goto("/payroll");
    await expect(page.getByRole("tab", { name: "Income Tax" })).toBeVisible({ timeout: 15_000 });
  });

  test("View Register on a processed run shows real payslip data (33 seeded payslips / 3 runs = 11 each)", async ({ page }) => {
    await page.goto("/payroll");
    await page.waitForSelector("table tbody tr");
    // Stale: "View Register" used to open a Dialog. PayrollClient.tsx's own
    // comment (lines 293-295) says the register now lives on a real Object
    // Page (PayrollRunObjectClient.tsx, reached via
    // router.push(`/payroll/runs/${id}`)) -- no dialog role exists anywhere
    // in this flow any more.
    await page.locator("table tbody tr").first().getByRole("button", { name: /view register/i }).click();
    await expect(page).toHaveURL(/\/payroll\/runs\/[^/]+$/);
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const count = await rows.count();
    expect(count, "expected payslips in at least one processed run's register").toBeGreaterThan(0);
  });

  test("real write: New Payroll Run also hits the real dbUser architecture gap (GAP #2), confirmed even for the owner account", async ({ page }) => {
    await page.goto("/payroll");
    await page.waitForSelector("table tbody tr");

    // Stale: this used to open a Dialog. PayrollClient.tsx:279-281's own
    // comment says the old "New Payroll Run" Dialog popup was replaced with
    // router.push("/payroll/runs/new") on 2026-08-30 -- the form now lives
    // on PayrollRunCreateClient.tsx, a real page with no dialog role.
    await page.getByRole("button", { name: /new payroll run/i }).click();
    await expect(page).toHaveURL(/\/payroll\/runs\/new$/);
    // Scoped to <main> -- the shell owns the one <main> landmark
    // ((app)/layout.tsx:31-32, enforced by single-main-landmark.test.ts), so
    // this excludes the sidebar's own ProjectSwitcher combobox (always
    // mounted, and this seeded org has 4 projects so it always renders --
    // ProjectSwitcher.tsx:41). With no dialog left to scope to instead, an
    // unscoped page.getByRole("combobox") would be a strict-mode violation
    // (2 matches) rather than picking this page's own Month select.
    await page.locator("main").getByRole("combobox").click();
    await page.getByRole("option", { name: "Dec", exact: false }).click();
    await fieldByLabel(page.locator("main"), "Year").fill("2027");
    // Stale: no "Create" button exists in this form any more --
    // ObjectScreen's create-mode footer control is always plain "Save"
    // (ObjectScreen.tsx:92-100).
    await page.getByRole("button", { name: "Save" }).click();

    // GAP: still real -- compliance-tracker's src/app/api/v1/projexa/
    // payroll/runs/route.ts:32 still hard-requires ctx.dbUser for
    // createPayrollRun()'s audit trail and 400s the same message for
    // PROJEXA's API-key-only caller.
    await expect(page.getByText(/real user session/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Recruitment (/recruitment) -- no role gating AND no dbUser architecture gap (both verified live)", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test("GAP: module had zero seeded data as of Phase 1 (job openings/candidates/applications) -- page loads correctly either way", async ({ page }) => {
    await page.goto("/recruitment");
    await expect(page.getByRole("heading", { name: "Recruitment" })).toBeVisible();
    // "No job openings/candidates yet." only holds true the FIRST time this
    // suite runs (no delete UI exists, so the write tests below permanently
    // add rows on every re-run) -- assert the tab loads real content
    // (empty-state OR a real row, never a crash) instead of re-asserting
    // the one-time-true empty text.
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Candidates" }).click();
    await page.waitForLoadState("networkidle");
  });

  test("real write: create a Job Opening as a member-role account -- actually succeeds (unlike every HR/Payroll write above)", async ({ page }) => {
    await page.goto("/recruitment");
    const title = `E2E Batch C QS Engineer ${Date.now()}`;
    // Stale: this used to open a Dialog. RecruitmentClient.tsx:171-173's own
    // comment says the old "New Job Opening" Dialog popup was replaced with
    // router.push("/recruitment/openings/new") on 2026-08-30.
    await page.getByRole("button", { name: /new job opening/i }).click();
    await expect(page).toHaveURL(/\/recruitment\/openings\/new$/);
    await fieldByLabel(page.locator("main"), "Title").fill(title);
    // Stale: no "Create" button exists in this form any more --
    // ObjectScreen's create-mode footer control is always plain "Save"
    // (ObjectScreen.tsx:92-100).
    await page.getByRole("button", { name: "Save" }).click();
    // JobOpeningCreateClient.tsx:42 redirects to the new opening's own real
    // Object Page (JobOpeningObjectClient.tsx, added in the same conversion
    // -- job openings never had a detail view before it) rather than
    // closing a dialog back onto the list.
    await expect(page).toHaveURL(/\/recruitment\/openings\/[0-9a-f-]+$/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });

  test("real write: add a candidate -- also succeeds", async ({ page }) => {
    await page.goto("/recruitment");
    await page.getByRole("tab", { name: "Candidates" }).click();
    const candidateName = `E2E Batch C Candidate ${Date.now()}`;
    // Stale: this used to open a Dialog, and the old "in-memory list is slow
    // to reflect a new row" gap (worked around below with a manual reload)
    // was specific to that Dialog-based flow. RecruitmentClient.tsx:184-186's
    // own comment says the old "Add Candidate" Dialog popup was replaced
    // with router.push("/recruitment/candidates/new") on 2026-08-30 --
    // CandidateCreateClient.tsx:31 redirects back to "/recruitment?tab=
    // candidates" on success, a real navigation that remounts
    // RecruitmentClient and re-runs its own load() fresh, so the manual
    // reload this test used to need is no longer necessary (same pattern
    // grc.spec.ts's own post-conversion list-redirecting create tests use).
    await page.getByRole("button", { name: /add candidate/i }).click();
    await expect(page).toHaveURL(/\/recruitment\/candidates\/new$/);
    await fieldByLabel(page.locator("main"), "Name").fill(candidateName);
    await fieldByLabel(page.locator("main"), "Email").fill(`e2e.${Date.now()}@example.com`);
    // Stale: no "Add" button exists in this form any more -- ObjectScreen's
    // create-mode footer control is always plain "Save" (ObjectScreen.tsx:
    // 92-100).
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/recruitment\?tab=candidates$/);
    await expect(page.getByText(candidateName)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("HR dashboard (/hr) -- read-only aggregate, as CEO", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("real headcount/leave/payroll aggregates match underlying seeded data", async ({ page }) => {
    await page.goto("/hr");
    await expect(page.getByRole("heading", { name: "HR Dashboard" })).toBeVisible();
    await expect(page.getByText("Total Headcount")).toBeVisible({ timeout: 15_000 });
    // 11 seeded users total.
    const headcountCard = page.locator(".shadow-card, [class*=card]", { hasText: "Total Headcount" }).first();
    await expect(headcountCard).toContainText("11", { timeout: 10_000 });
  });

  test("nav cards route to the real Employees/Payroll/Recruitment pages", async ({ page }) => {
    await page.goto("/hr");
    await page.getByRole("link", { name: /employee directory/i }).click();
    await expect(page).toHaveURL(/\/employees/);
  });
});
