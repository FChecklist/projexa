import { test, expect, request as pwRequest } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Owner directive "Merge 6" gap-closure. Fills in THREE of the workspace
// page's 11 embedded sections that sumeet-project-workspace-env1.spec.ts
// deliberately left for a follow-up spec (its own Billing Milestones test
// only ever drives create -> draft -> submit -> approve, and its Insights
// test only checks the P&L heading + the (known-flaky-under-RAM-pressure)
// exceptions count):
//   - Site Diary (#site-diary): real seeded entries render for the two roles
//     that can see the section (owner, site_engineer) -- not just a
//     visibility check, an actual data check.
//   - Billing Milestones (#billing-milestones, R-95): extends the state
//     machine coverage past "approve" into reject -> redraft -> resubmit ->
//     approve -> invoice, AND checks the two roles workspace-visibility.ts
//     grants VIEW access to the section that are NOT owner/pm --
//     member ("Finance"-titled, real role `member`) and client_viewer.
//   - Insights (#insights, R-99/R-100): a genuine "combined view" check
//     (BOQ change + scope changes + billing milestones together, not P&L
//     alone), plus one deeper, non-fragile R-100 angle tying a real
//     API-fetched boolean to what actually renders.
//
// FIXED (2026-09-19, Owner sign-off, chat): src/app/api/billing-claims/
// route.ts's POST and src/app/api/billing-claims/[id]/route.ts's PATCH used
// to gate EVERY action on requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE) =
// ["owner","admin","pm"] -- which excluded both `member` and `client_viewer`
// even though workspace-visibility.ts grants both of them VIEW access to
// this section, and BillingMilestonesClient.tsx renders the same
// Draft/Submit/Approve/Reject/Invoice buttons to any caller who can see a
// claim in that status, with no role prop. That contradicted the Owner's
// own Merge 6 role spec verbatim ("member w/ cost-visibility ... Billing
// (draft/submit/invoice, not decide)"; "client_viewer ... Billing
// Milestones (approve/reject at Submitted only)"). Both routes now narrow
// PM_OR_ABOVE per-action instead of replacing it: member reaches
// draft/submit/invoice (not approve/reject), client_viewer reaches
// approve/reject (not draft/submit/invoice), owner/admin/pm keep every
// action exactly as before. The tests below assert the NEW real behavior
// (a real, persisted transition) for the actions each role is now granted,
// and confirm the deliberately-still-refused actions (member deciding,
// client_viewer drafting) still 403.
const PROJECT_ID = DEFAULT_PROJECT.id;

// Shared across describes below. playwright.config.ts sets
// `fullyParallel: false` repo-wide specifically so a single file's tests run
// sequentially in one worker in declaration order -- the same guarantee
// sumeet-project-workspace-env1.spec.ts's own multi-describe structure
// already relies on. The owner-role setup test (declared further down)
// populates this with a real, persisted, Submitted-status milestone's
// description; the client_viewer describe (declared after it) locates and
// attempts to act on that same real row.
let submittedMilestoneDescription = "";

// Same technique sumeet-billing-milestones-env1.spec.ts's own setup uses:
// poll boq-analysis for an existing approved BOQ first (this shared,
// persistent E2E project very likely already has one, from that spec's own
// runs against the same DEFAULT_PROJECT), and only create+approve a fresh
// one if genuinely none exists yet. approveBoq() refuses self-approval (a
// real, intentional product guard -- "you cannot approve a BOQ you created
// yourself"), so creation (CEO) and approval (a separate PM-tier account)
// go through two different authenticated contexts, exactly like that spec.
async function ensureApprovedBoqId(page: import("@playwright/test").Page): Promise<string | null> {
  const existing = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
  if (existing.ok()) {
    const { row } = await existing.json();
    if (row?.boqId) return row.boqId;
  }

  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: `Workspace insights/billing spec BOQ ${Date.now()}`,
      lineItems: [{ itemCode: "WS-LINE", description: "Workspace spec line", unit: "sqm", quantity: 10, rate: 100 }],
    },
  });
  if (!createRes.ok()) return null;
  const boq = await createRes.json();

  const submitRes = await page.request.post(`/api/scope/${boq.id}/submit`);
  if (!submitRes.ok()) return null;

  const financeCtx = await pwRequest.newContext({
    storageState: "playwright/.auth/finance.json",
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://projexa-ai.com",
  });
  const approveRes = await financeCtx.post(`/api/scope/${boq.id}/approve`);
  await financeCtx.dispose();
  if (!approveRes.ok()) return null;

  const poll = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
  if (!poll.ok()) return null;
  const { row } = await poll.json();
  return row?.boqId ?? null;
}

// ---------------------------------------------------------------------------
// Site Diary (#site-diary) -- real entries, not a placeholder.
// PHASE1_SEED_REPORT.md records 60 site-diary entries seeded (15 consecutive
// days x 4 projects), so DEFAULT_PROJECT (Meridian Heights) should carry 15
// of its own -- but this spec verifies against whatever the live API
// actually returns right now, not that recorded number, and skips (not
// fails) if the count has genuinely gone to zero.
// ---------------------------------------------------------------------------

test.describe("Site Diary (#site-diary): owner sees the real seeded entries", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("table rows match the real GET /api/site-diary response for this project", async ({ page }) => {
    const section = page.locator("#site-diary");
    // site-diary is the 2nd of 11 sections -- well within LazyMount's 400px
    // rootMargin of the initial viewport on most screen sizes, unlike
    // Insights (the 11th/last section), so its fetch typically fires during
    // the initial networkidle wait without an explicit scroll. Scrolling
    // afterward is a harmless no-op once already mounted, and a real safety
    // net on a narrower viewport.
    const [diaryRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/site-diary") && r.request().method() === "GET"),
      page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" }),
    ]);
    await section.scrollIntoViewIfNeeded();

    const { diaries } = await diaryRes.json();
    test.skip(!diaries || diaries.length === 0, "no site diary entries seeded for this project right now -- PHASE1_SEED_REPORT.md records 15 for it, so an empty result here would itself be worth investigating separately");

    await expect(
      section.locator("table tbody tr"),
      "the embedded SiteDiaryClient must render exactly one real row per diary entry the API actually returned, not a placeholder count"
    ).toHaveCount(diaries.length);

    const first = diaries[0] as { workDone: string | null };
    if (first.workDone) {
      await expect(
        section.locator("table tbody tr").first(),
        "the first row's Work Done cell must show REAL text from the API response, not a dash placeholder"
      ).toContainText(first.workDone.slice(0, 15));
    }
  });
});

test.describe("Site Diary (#site-diary): site_engineer (Manoj Yadav) sees the same real entries", () => {
  test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

  test("table rows match the real GET /api/site-diary response for this project", async ({ page }) => {
    const section = page.locator("#site-diary");
    const [diaryRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/site-diary") && r.request().method() === "GET"),
      page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" }),
    ]);
    await section.scrollIntoViewIfNeeded();

    const { diaries } = await diaryRes.json();
    test.skip(!diaries || diaries.length === 0, "no site diary entries seeded for this project right now");

    await expect(
      section.locator("table tbody tr"),
      "site_engineer must see the exact same real row count as owner -- GET /api/site-diary carries no role filter (only requireAuth, no requireRole)"
    ).toHaveCount(diaries.length);
  });
});

// ---------------------------------------------------------------------------
// Billing Milestones (#billing-milestones) -- R-95: full state machine, and
// the real reach/authority boundary between roles that can SEE the section
// and roles that can actually ACT on it.
// ---------------------------------------------------------------------------

test.describe("Billing Milestones (#billing-milestones): owner/pm write authority reaches every real transition (R-95)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("reject -> redraft -> resubmit -> approve -> (invoice if a tax template exists), through the embedded workspace card", async ({ page }) => {
    const boqId = await ensureApprovedBoqId(page);
    test.skip(!boqId, "no approved BOQ reachable/creatable for this project -- the create form's own client-side gate can't be exercised without one");

    const customersRes = await page.request.get("/api/customers");
    expect(customersRes.ok(), "listing customers must succeed").toBe(true);
    const { customers } = await customersRes.json();
    test.skip(!customers?.length, "at least one real customer is needed to drive the create form");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("button", { name: /new billing milestone/i })).toBeEnabled({ timeout: 15_000 });

    await section.getByRole("button", { name: /new billing milestone/i }).click();
    const description = `Workspace reject/redraft spec ${Date.now()}`;
    await section.getByLabel("Customer").selectOption({ index: 1 });
    await section.getByLabel("Milestone description").fill(description);
    await section.getByLabel("Scheduled date").fill("2026-11-15");
    await section.getByRole("button", { name: /^save$/i }).click();

    const row = section.locator("li", { hasText: description });
    await expect(row, "the created milestone must persist and re-render through the embedded card, same as the standalone /billing-milestones screen").toBeVisible({ timeout: 15_000 });

    await row.getByRole("button", { name: /^draft$/i }).click();
    await expect(row.getByText(/^drafted$/i)).toBeVisible({ timeout: 10_000 });

    await row.getByRole("button", { name: /^submit$/i }).click();
    await expect(row.getByText(/^submitted$/i)).toBeVisible({ timeout: 10_000 });

    // NEW coverage beyond sumeet-billing-milestones-env1.spec.ts, which stops
    // at approve: reject -> redraft -> resubmit -> approve, the two branches
    // BillingMilestonesClient.tsx's own header comment calls out ("rejected ->
    // drafted") as part of the real, append-only, no-delete state machine.
    await row.getByRole("button", { name: /^reject$/i }).click();
    const reason = "Sumeet workspace spec: client disputes quantities";
    await row.getByLabel("Reason").fill(reason);
    await row.getByRole("button", { name: /confirm reject/i }).click();
    await expect(row.getByText(/^rejected$/i), "status badge must read Rejected after the real Reject+Confirm click").toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(reason, { exact: false }), "the real rejection reason must render inline, not be silently dropped").toBeVisible();

    await row.getByRole("button", { name: /^redraft$/i }).click();
    await expect(row.getByText(/^drafted$/i), "Redraft must move a rejected claim back to Drafted -- the append-only 'rejected -> drafted' path this component's own header comment documents").toBeVisible({ timeout: 10_000 });

    await row.getByRole("button", { name: /^submit$/i }).click();
    await expect(row.getByText(/^submitted$/i)).toBeVisible({ timeout: 10_000 });

    await row.getByRole("button", { name: /^approve$/i }).click();
    await expect(row.getByText(/client approved/i), "status badge must read Client Approved after the real (re-)Approve click").toBeVisible({ timeout: 10_000 });

    const taxRes = await page.request.get("/api/tax-templates");
    const taxTemplates = taxRes.ok() ? ((await taxRes.json()).taxTemplates ?? []) : [];
    if (taxTemplates.length === 0) {
      test.info().annotations.push({
        type: "partial-coverage",
        description: "Invoice transition not exercised this run -- no tax templates configured for this org (BillingMilestonesClient.tsx's own documented, real gate: 'No tax templates configured -- set one up in Accounting first'). Reject/redraft/resubmit/approve above are still fully exercised and asserted.",
      });
      return;
    }
    await row.getByRole("button", { name: /^invoice$/i }).click();
    await row.getByLabel("Bill date").fill("2026-11-20");
    await row.getByLabel("Tax template").selectOption({ index: 1 });
    await row.getByRole("button", { name: /confirm invoice/i }).click();
    await expect(row.getByText(/^invoiced$/i), "status badge must read Invoiced after the real Invoice+Confirm click").toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole("button", { name: /view invoice/i }), "an invoiced claim must expose a real link to the created invoice, not just a terminal status label").toBeVisible();
  });

  test("setup: creates and submits a SECOND milestone, left in Submitted status, for the client_viewer authz-gap test below", async ({ page }) => {
    const boqId = await ensureApprovedBoqId(page);
    test.skip(!boqId, "no approved BOQ reachable/creatable for this project -- the client_viewer describe below will itself skip when submittedMilestoneDescription stays empty");
    if (!boqId) return;

    const customersRes = await page.request.get("/api/customers");
    const { customers } = customersRes.ok() ? await customersRes.json() : { customers: [] };
    test.skip(!customers?.length, "at least one real customer is needed to drive the create form");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: /new billing milestone/i }).click();

    const description = `Workspace client-viewer-gap spec ${Date.now()}`;
    await section.getByLabel("Customer").selectOption({ index: 1 });
    await section.getByLabel("Milestone description").fill(description);
    await section.getByLabel("Scheduled date").fill("2026-11-18");
    await section.getByRole("button", { name: /^save$/i }).click();

    const row = section.locator("li", { hasText: description });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: /^draft$/i }).click();
    await expect(row.getByText(/^drafted$/i)).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /^submit$/i }).click();
    await expect(row.getByText(/^submitted$/i)).toBeVisible({ timeout: 10_000 });

    submittedMilestoneDescription = description;
  });
});

test.describe("Billing Milestones (#billing-milestones): member (Sneha Reddy, 'Finance'-titled, real role=member) can now draft a real milestone (R-95 authz fix)", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test("New Billing Milestone succeeds for member -- POST /api/billing-claims now allows member, per the Owner's own 'draft/submit/invoice' Finance spec", async ({ page }) => {
    const boqRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    test.skip(!boqRes.ok(), "boq-analysis must be reachable to run this check");
    const { row } = await boqRes.json();
    test.skip(!row?.boqId, "no approved BOQ exists for this project -- the create control's OWN client-side gate (disabled={!boqId}) would already disable it, confounding the assertion");

    const customersRes = await page.request.get("/api/customers");
    test.skip(!customersRes.ok(), "customers list must be reachable to fill the create form");
    const { customers } = await customersRes.json();
    test.skip(!customers?.length, "at least one real customer is needed to drive the create form");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await expect(section, "member must see this section at all -- workspace-visibility.ts's MEMBER_FINANCE list includes billing-milestones").toBeVisible();
    await section.scrollIntoViewIfNeeded();

    const newButton = section.getByRole("button", { name: /new billing milestone/i });
    await expect(newButton, "member sees the same enabled create control an owner/pm does").toBeEnabled({ timeout: 15_000 });

    await newButton.click();
    const description = `Workspace member-authz-fix spec ${Date.now()}`;
    await section.getByLabel("Customer").selectOption({ index: 1 });
    await section.getByLabel("Milestone description").fill(description);
    await section.getByLabel("Scheduled date").fill("2026-11-19");
    await section.getByRole("button", { name: /^save$/i }).click();

    await expect(section.locator("li", { hasText: description }), "member's real create must persist and re-render, same as it would for owner/pm").toBeVisible({ timeout: 15_000 });

    // Direct, timing-independent confirmation of the fix (same style as the
    // 403 checks elsewhere in this suite): a fresh POST as member succeeds.
    const description2 = `Workspace member-authz-fix spec direct ${Date.now()}`;
    const apiRes = await page.request.post("/api/billing-claims", {
      data: { projectId: PROJECT_ID, boqId: row.boqId, customerId: customers[0].id, milestoneDescription: description2, scheduledDate: "2026-11-19", retentionPercent: 0 },
    });
    expect(apiRes.ok(), "member must now be able to create a billing milestone directly via the API too").toBe(true);
    const created = await apiRes.json();

    // But member still cannot DECIDE (approve/reject) -- only draft/submit/
    // invoice, per the Owner's own "not decide" wording. Draft it first so
    // there's a real claim id, then confirm the decide actions still 403.
    const draftRes = await page.request.patch(`/api/billing-claims/${created.id}`, { data: { action: "draft" } });
    expect(draftRes.ok(), "member must be able to draft the claim they just created").toBe(true);
    const approveRes = await page.request.patch(`/api/billing-claims/${created.id}`, { data: { action: "approve" } });
    expect(approveRes.status(), "member must still be refused approve -- Owner spec: draft/submit/invoice, NOT decide").toBe(403);
  });
});

test.describe("Billing Milestones (#billing-milestones): client_viewer (Karan Malhotra) can now decide at the Submitted stage (R-95 authz fix)", () => {
  test.use({ storageState: "playwright/.auth/clientViewer.json" });

  test("Approve succeeds for client_viewer at Submitted -- PATCH now allows client_viewer for approve/reject, per the Owner's own Merge 6 spec", async ({ page }) => {
    test.skip(!submittedMilestoneDescription, "the owner-role setup test above did not produce a Submitted milestone to check (see its own skip reason -- most likely no approved BOQ was reachable/creatable)");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await expect(section, "client_viewer must see this section at all -- workspace-visibility.ts's CLIENT_VIEWER list includes billing-milestones").toBeVisible();
    await section.scrollIntoViewIfNeeded();

    const row = section.locator("li", { hasText: submittedMilestoneDescription });
    await expect(row, "the milestone the owner just submitted must be visible to client_viewer too -- GET /api/billing-claims carries no role filter").toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(/^submitted$/i)).toBeVisible();

    const approveButton = row.getByRole("button", { name: /^approve$/i });
    await expect(approveButton, "BillingMilestonesClient.tsx renders Approve for any caller who can see a Submitted claim").toBeVisible();

    await approveButton.click();
    await expect(row.getByText(/^client_approved$/i), "the real transition must persist and re-render for client_viewer, same as it would for owner/pm").toBeVisible({ timeout: 15_000 });

    // Direct, timing-independent confirmation: client_viewer still cannot
    // draft/submit/invoice (they only ever decide at Submitted) -- create a
    // fresh claim as owner-equivalent context is out of scope here, so just
    // confirm the "draft" action itself still 403s for client_viewer against
    // the claim they just approved (an invalid transition either way, but
    // the role gate must fire before the state-machine gate would).
    const listRes = await page.request.get(`/api/billing-claims?projectId=${encodeURIComponent(PROJECT_ID)}&all=true`);
    expect(listRes.ok(), "client_viewer must still be able to READ the claims list -- GET is not role-gated").toBe(true);
    const { claims } = await listRes.json();
    const claim = (claims ?? []).find((c: { milestoneDescription: string }) => c.milestoneDescription === submittedMilestoneDescription);
    test.skip(!claim, "could not re-resolve the claim's id via the list API -- the UI-level success above already stands on its own");
    expect(claim.status, "the claim's real, re-fetched status must reflect the approval").toBe("client_approved");
    const draftRes = await page.request.patch(`/api/billing-claims/${claim.id}`, { data: { action: "draft" } });
    expect(draftRes.status(), "client_viewer must still be refused draft -- Owner spec: approve/reject ONLY, never draft/submit/invoice").toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Insights (#insights) -- R-99 (genuine combined view, not P&L alone) and a
// deeper, non-fragile R-100 angle.
// ---------------------------------------------------------------------------

test.describe("Insights (#insights): the real combined analysis view (R-99), plus a deeper P&L truth check (R-100)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("Project360Client surfaces BOQ change, scope changes AND billing milestones together in one section", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#insights");
    const [analysisRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/reports/boq-analysis") && r.request().method() === "GET"),
      section.scrollIntoViewIfNeeded(),
    ]);

    // R-99's actual requirement text is "one combined analysis view over
    // change of BOQ, change of scope, billing, milestones, and timelines".
    // Project360Client.tsx's own header comment maps each of these to a real
    // read (boq-analysis / change-orders / milestones / billing-claims /
    // schedule-gantt), rendered as adjacent cards within this ONE section --
    // not five separate pages. Checked against its actual rendered JSX
    // headings (read directly, not assumed): at least 3 of the 4 non-P&L
    // categories, plus the P&L answer itself.
    await expect(section.getByText("Change of BOQ", { exact: true }), "the BOQ-change card must render inside the combined Insights view").toBeVisible();
    await expect(section.getByText("Scope changes", { exact: true }), "the scope-change card must render inside the SAME combined view, not a separate page").toBeVisible();
    await expect(section.getByText("Billing milestones", { exact: true }), "the billing-milestones card must render inside the SAME combined view").toBeVisible();
    await expect(section.getByText("Timeline", { exact: true }).first(), "the timeline card must render inside the SAME combined view").toBeVisible();
    await expect(section.getByText("Profit & Loss", { exact: false }), "the P&L answer must render in this same section too -- it is one of the combined figures, not a separate feature").toBeVisible();

    // R-100 deeper check: the existing spec's own "Profit & Loss -- the
    // answer" visibility assertion is already a fair, real base check for
    // R-100 -- deliberately not duplicated here. Instead, tie a genuinely
    // NEW angle to a real API-fetched value rather than the section's mere
    // presence: hasBaseline is a real boolean this exact API call returned,
    // and Project360Client.tsx's own JSX only renders the "No baseline has
    // been confirmed..." caption when it is false (read directly from its
    // source, not assumed) -- so the caption's presence/absence must track
    // the API's own truth, not just render unconditionally either way.
    const { row } = await analysisRes.json();
    const baselineCaption = section.getByText(/no baseline has been confirmed/i);
    if (row.hasBaseline) {
      await expect(baselineCaption, "hasBaseline=true from the real API must mean the 'not yet baselined' placeholder caption is ABSENT, not just unchecked").toHaveCount(0);
    } else {
      await expect(baselineCaption, "hasBaseline=false from the real API must mean the real placeholder caption IS shown, not silently omitted").toBeVisible();
    }
  });
});
