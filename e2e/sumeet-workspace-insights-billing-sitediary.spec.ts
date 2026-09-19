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
// REAL, SURPRISING FINDING (grounded in source, not guessed -- see
// src/lib/authz/roles.ts, src/lib/authz/api-write-policy.ts, and the two
// billing-claims route.ts files): workspace-visibility.ts grants BOTH
// `member` (MEMBER_FINANCE) and `client_viewer` (CLIENT_VIEWER) VIEW access
// to the Billing Milestones section, and BillingMilestonesClient.tsx takes
// no role prop -- it renders the exact same Draft/Submit/Approve/Reject/
// Invoice buttons to every caller who can see a claim in that status,
// regardless of who they are. But POST /api/billing-claims and
// PATCH /api/billing-claims/[id] both gate on requireRole(ctx,
// ROLE_GROUPS.PM_OR_ABOVE) = ["owner","admin","pm"] -- which EXCLUDES both
// `member` and `client_viewer`. So a member or client_viewer genuinely sees
// live, enabled write controls for a feature the real API refuses them for.
// This is the exact same class of gap r90-real-backend-error-in-toast-env1.spec.ts
// and r11-boq-create-form-subtask-fields-env1.spec.ts already document for
// /scope -- not a new defect, but not previously checked for THIS route or
// THIS embedded-workspace surface either. Per this task's own instruction to
// stay honest about what's reachable rather than force a fictitious "success"
// path, the member/client_viewer tests below assert the REAL behavior (a
// visible, named 403 refusal, state unchanged) rather than the transition
// itself succeeding.
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

test.describe("Billing Milestones (#billing-milestones): member (Sneha Reddy, 'Finance'-titled but real role=member) sees the create control, but the real API refuses it (authz gap, R-95)", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test("New Billing Milestone is visible and enabled for member, but Save is refused 403 -- ROLE_GROUPS.PM_OR_ABOVE excludes member", async ({ page }) => {
    const boqRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    test.skip(!boqRes.ok(), "boq-analysis must be reachable to run this check");
    const { row } = await boqRes.json();
    test.skip(!row?.boqId, "no approved BOQ exists for this project -- the create control's OWN client-side gate (disabled={!boqId}, unrelated to the role gate this test is about) would already disable it, confounding the assertion");

    const customersRes = await page.request.get("/api/customers");
    test.skip(!customersRes.ok(), "customers list must be reachable to fill the create form");
    const { customers } = await customersRes.json();
    test.skip(!customers?.length, "at least one real customer is needed to drive the create form");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await expect(section, "member must see this section at all -- workspace-visibility.ts's MEMBER_FINANCE list includes billing-milestones").toBeVisible();
    await section.scrollIntoViewIfNeeded();

    const newButton = section.getByRole("button", { name: /new billing milestone/i });
    // REAL, SURPRISING FINDING (see the file header comment): the button is
    // only ever disabled on `!boqId` in BillingMilestonesClient.tsx -- it
    // takes no role prop, so member sees the exact same enabled create
    // control an owner/pm does.
    await expect(newButton, "member sees the SAME enabled create control an owner/pm does -- section-level visibility does not narrow which actions render inside it").toBeEnabled({ timeout: 15_000 });

    await newButton.click();
    const description = `Workspace member-gap spec ${Date.now()}`;
    await section.getByLabel("Customer").selectOption({ index: 1 });
    await section.getByLabel("Milestone description").fill(description);
    await section.getByLabel("Scheduled date").fill("2026-11-19");
    await section.getByRole("button", { name: /^save$/i }).click();

    const toast = page.locator("[data-sonner-toast]").filter({ hasText: /forbidden|role.*permit/i });
    await expect(toast, "a member Save click must surface a real, visible Forbidden refusal (toast.error, per BillingMilestonesClient.tsx's own catch block) -- not a silent hang and not a false 'created' success").toBeVisible({ timeout: 15_000 });
    await expect(section.locator("li", { hasText: description }), "the write must never have landed -- no such milestone should appear in the list for a refused create").toHaveCount(0);

    // Direct, timing-independent confirmation of the same gate (same style
    // as e2e/r11-boq-create-form-subtask-fields-env1.spec.ts's own member-role
    // check for /scope).
    const apiRes = await page.request.post("/api/billing-claims", {
      data: { projectId: PROJECT_ID, boqId: row.boqId, customerId: customers[0].id, milestoneDescription: description, scheduledDate: "2026-11-19", retentionPercent: 0 },
    });
    expect(apiRes.status(), "PM_OR_ABOVE gate must answer 403 for member, matching the UI refusal just observed").toBe(403);
  });
});

test.describe("Billing Milestones (#billing-milestones): client_viewer (Karan Malhotra) sees the Submitted-stage approve/reject control, but the real API refuses it too (same authz gap, R-95)", () => {
  test.use({ storageState: "playwright/.auth/clientViewer.json" });

  test("Approve/Reject render for a real Submitted milestone, but clicking Approve is refused 403 -- ROLE_GROUPS.PM_OR_ABOVE excludes client_viewer", async ({ page }) => {
    test.skip(!submittedMilestoneDescription, "the owner-role setup test above did not produce a Submitted milestone to check (see its own skip reason -- most likely no approved BOQ was reachable/creatable)");

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    await expect(section, "client_viewer must see this section at all -- workspace-visibility.ts's CLIENT_VIEWER list includes billing-milestones").toBeVisible();
    await section.scrollIntoViewIfNeeded();

    const row = section.locator("li", { hasText: submittedMilestoneDescription });
    await expect(row, "the milestone the owner just submitted must be visible to client_viewer too -- GET /api/billing-claims carries no role filter").toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(/^submitted$/i)).toBeVisible();

    const approveButton = row.getByRole("button", { name: /^approve$/i });
    const rejectButton = row.getByRole("button", { name: /^reject$/i });
    // REAL, SURPRISING FINDING (see the file header comment): both controls
    // render for client_viewer exactly as they would for owner/pm --
    // BillingMilestonesClient.tsx renders them purely off `c.status ===
    // "submitted"`, with no role check at all.
    await expect(approveButton, "BillingMilestonesClient.tsx renders Approve/Reject for ANY caller who can see a Submitted claim -- it takes no role prop and does not hide these for client_viewer").toBeVisible();
    await expect(rejectButton).toBeVisible();

    await approveButton.click();
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: /forbidden|role.*permit/i });
    await expect(toast, "a client_viewer Approve click must surface a real, visible Forbidden refusal -- not a silent no-op and not a false success").toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(/^submitted$/i), "the claim must remain Submitted -- a refused write must never advance the real state machine").toBeVisible();

    // Direct, timing-independent confirmation of the same gate, against the
    // real claim id (resolved via the same GET the embedded card itself uses).
    const listRes = await page.request.get(`/api/billing-claims?projectId=${encodeURIComponent(PROJECT_ID)}&all=true`);
    expect(listRes.ok(), "client_viewer must still be able to READ the claims list -- GET is not PM_OR_ABOVE-gated").toBe(true);
    const { claims } = await listRes.json();
    const claim = (claims ?? []).find((c: { milestoneDescription: string }) => c.milestoneDescription === submittedMilestoneDescription);
    test.skip(!claim, "could not re-resolve the claim's id via the list API -- the UI-level refusal above already stands on its own");
    const patchRes = await page.request.patch(`/api/billing-claims/${claim.id}`, { data: { action: "approve" } });
    expect(patchRes.status(), "PM_OR_ABOVE gate must answer 403 for client_viewer, matching the UI refusal just observed").toBe(403);
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
