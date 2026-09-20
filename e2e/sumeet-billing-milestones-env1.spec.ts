import { test, expect, request as pwRequest } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Sumeet requirement #3 ("BILLING MILESTONES") -- the real write UI
// (BillingMilestonesClient.tsx / compliance-tracker PR #1751, PROJEXA PR
// #285). GAP FOUND (2026-09-19, Playwright gap-closure sweep): neither this
// feature nor the exceptions report (sibling spec
// sumeet-exceptions-env1.spec.ts) had any Playwright E2E coverage at all --
// only Bun unit/route/component tests existed. This is Round 1's fill for
// that gap.
//
// Runs against Env-1 (localhost:3000/3100, PLAYWRIGHT_BASE_URL override),
// real browser, real HTTP, real Postgres -- not a mock.
test.use({ storageState: "playwright/.auth/ceo.json" });

const PROJECT_ID = DEFAULT_PROJECT.id;

test("Sumeet #3: a billing milestone can be created, drafted, submitted and approved through the real UI", async ({ page }) => {
  // TEST-LEVEL TIMEOUT RAISED (R-95 re-audit, 2026-09-20): this test chains
  // SIX sequential network-dependent waits, each individually raised to
  // 30_000ms below for the same documented CI-latency reasons (create,
  // submit, approve, the boq-analysis poll, then Draft/Submit/Approve
  // status-badge waits, then the timeline). A real isolated CI run
  // (compliance-tracker workflow_dispatch run 35498527292) hit playwright.
  // config.ts's default per-test budget (75_000ms) with "Test timeout of
  // 75000ms exceeded" while legitimately waiting on the LAST of those six
  // steps -- the sum of several individually-justified 30s waits can
  // exceed a 75s whole-test budget even when no single step is actually
  // broken.
  //
  // MERGE NOTE (PROJEXA-E2E-001, 2026-09-20): two independent sessions
  // raised this same budget concurrently -- this PR's own branch proposed
  // 120_000ms, while `main` had already landed 150_000ms via the identical
  // "e2e-env1 CI fix" pattern applied to the sibling /api/exceptions specs.
  // Kept the larger, already-CI-proven value rather than shrinking it back
  // down; both figures were derived from the same six/seven-step chain, so
  // there is no functional disagreement, only a difference in headroom.
  test.setTimeout(150_000);

  // Setup: the create form is disabled until the project has an APPROVED
  // BOQ (BillingMilestonesClient.tsx's own NO_APPROVED_BOQ_REASON gate) --
  // a live check this run found every existing BOQ on this project is
  // 'draft', so this spec creates and approves its own, through the real
  // submit -> approve API a manager's own clicks would hit (POST
  // /api/scope, then /api/scope/{id}/submit, then /api/scope/{id}/approve).
  const boqTitle = `Sumeet-3 env1 spec ${Date.now()}`;
  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: boqTitle,
      lineItems: [{ itemCode: "S3-LINE", description: "Sumeet-3 spec line", unit: "sqm", quantity: 10, rate: 100 }],
    },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const boq = await createRes.json();

  const submitRes = await page.request.post(`/api/scope/${boq.id}/submit`);
  expect(submitRes.ok(), "BOQ submit-for-approval must succeed for this spec's own setup").toBe(true);

  // REAL FINDING (2026-09-19, this spec's own first run): approveBoq()
  // (construction-boq-service.ts) genuinely refuses self-approval --
  // "You cannot approve a BOQ you created yourself -- an independent
  // approver is required" -- a real, intentional guard (Sumeet #6 "wrong
  // approval given"), not a bug. This BOQ was created as CEO above, so it
  // must be approved through a SEPARATE authenticated context (Finance
  // manager), matching what a real org would actually do.
  const financeCtx = await pwRequest.newContext({
    storageState: "playwright/.auth/finance.json",
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://projexa-ai.com",
  });
  const approveRes = await financeCtx.post(`/api/scope/${boq.id}/approve`);
  expect(approveRes.ok(), "BOQ approval by a DIFFERENT user must succeed for this spec's own setup").toBe(true);
  await financeCtx.dispose();

  // REAL FLAKE FOUND AND WORKED AROUND (2026-09-19, this spec's own
  // authoring): boq-analysis (getProjectAnalysis) resolves `effective.boqId`
  // to whichever approved BOQ its own "current effective contract" logic
  // picks for this project -- on this shared, persistent E2E test project,
  // that is NOT necessarily the BOQ this spec just approved (other specs'
  // own approved BOQs already exist here from earlier runs). This spec only
  // needs the create form's gate (BillingMilestonesClient's own
  // NO_APPROVED_BOQ_REASON check) to see SOME non-null boqId -- it does not
  // depend on which one -- so poll for non-null rather than for this exact
  // id, which also absorbs the real one-request propagation delay observed
  // in an earlier run of this same spec.
  //
  // TIMEOUT RAISED 15_000 -> 30_000 (R-95 re-audit, 2026-09-20). A fresh
  // audit found this exact assertion genuinely fails in real CI ("Received:
  // null" after the full 15s). Investigated the backend end to end
  // (compliance-tracker's boq-analysis-service.ts/construction-boq-
  // service.ts -- resolveApprovedBoq, getEffectiveContractValueForProject,
  // submitBoq/approveBoq) and confirmed via code review AND a real local
  // create->submit->approve->poll run against the live Supabase project
  // that there is no logic defect: an approved BOQ is visible to this exact
  // query immediately after approveBoq() commits. The real cause is this
  // program's own extensively-documented "E2E Tests (Env-1, cross-repo)"
  // CI job history (compliance-tracker's .github/workflows/ci.yml, inline
  // comments dated 2026-09-13): real, severe connection-latency spikes on
  // GitHub-hosted runners talking to the Supabase pooler (IPv6/Supavisor
  // auth-retry cascades documented there as pushing individual request
  // latency past 15s, up to 30s+). This poll's own 15_000ms was tighter
  // than this repo's own established minimum for a network-dependent
  // Playwright check (playwright.config.ts's actionTimeout/
  // navigationTimeout are both 30_000ms, raised for this identical
  // documented CI-latency class -- see that file's own "GAP FOUND
  // (2026-09-19, Playwright gap-closure Round 2)" comment). The assertion
  // itself is unchanged (still requires a real, non-null boqId, never
  // relaxed to tolerate a genuinely-missing approval) -- only the headroom
  // given to a slow-but-correct upstream now matches this suite's own
  // proven-sufficient standard instead of being the one outlier below it.
  // lastAnalysisStatus is logged (not asserted on) purely so a future
  // failure of this poll shows whether the upstream was ever answering with
  // a non-2xx (a real auth/scope/5xx problem) vs. only ever timing out
  // (the documented CI-latency class this fix targets) -- console output is
  // captured in the test report either way.
  let lastAnalysisStatus: number | null = null;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
        lastAnalysisStatus = res.status();
        if (!res.ok()) return null;
        const { row } = await res.json();
        return row?.boqId ?? null;
      },
      { message: "boq-analysis must report SOME approved BOQ before the create form can be exercised", timeout: 30_000 }
    )
    .not.toBeNull()
    .catch((err) => {
      console.log(`boq-analysis poll's last response status: ${lastAnalysisStatus}`);
      throw err;
    });

  // A real customer must exist for the create form's own customer <select>.
  const customersRes = await page.request.get("/api/customers");
  expect(customersRes.ok(), "listing customers must succeed").toBe(true);
  const { customers } = await customersRes.json();
  expect(Array.isArray(customers) && customers.length > 0, "at least one real customer must exist in this org to drive the create form").toBe(true);

  // The real user action under test: the create form, through real clicks.
  await page.goto(`/billing-milestones?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new billing milestone/i }).click();

  const description = `Sumeet-3 env1 milestone ${Date.now()}`;
  await page.getByLabel("Customer").selectOption({ index: 1 });
  await page.getByLabel("Milestone description").fill(description);
  // REAL GAP FOUND AND FIXED IN THE PRODUCT (2026-09-19, this spec's own
  // authoring): the backend has always required scheduledDate (a real 400
  // "scheduledDate is required" reproduced directly against the live local
  // server) but BillingMilestonesClient's own Save-button guard never
  // checked for it, so leaving this blank silently left the form open with
  // no inline guidance. Fixed alongside this spec -- Save is now disabled
  // with SCHEDULED_DATE_REQUIRED until this field is filled, same as the
  // description/customer guards already worked.
  await page.getByLabel("Scheduled date").fill("2026-10-15");
  await page.getByRole("button", { name: /^save$/i }).click();

  // Real, specific assertion: the new milestone renders in the list by its
  // own real, unique description text -- not just "a row appeared".
  const row = page.locator("li", { hasText: description });
  await expect(row, "the created milestone must appear in the real list, not just a toast").toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(/milestone achieved/i), "a freshly created claim must start in milestone_achieved status").toBeVisible();

  // Draft -> Submit -> Approve, each a real click, each asserted by the
  // status badge actually changing -- not by the button disappearing alone
  // (a stale list would also make the old button vanish).
  //
  // TIMEOUTS RAISED 10_000 -> 30_000 (R-95 re-audit, 2026-09-20, same pass
  // as the boq-analysis poll fix above). A real CI run on the fixed poll
  // got past it cleanly and then failed HERE instead ("status badge must
  // read Drafted after the real Draft click", Timeout: 10000ms) -- proving
  // this is the same documented CI-latency class hitting a DIFFERENT
  // network-dependent step in the same spec (click -> server mutation ->
  // UI re-fetch), not a one-off. Each of these four checks now matches this
  // suite's own established 30_000ms standard (playwright.config.ts's
  // actionTimeout/navigationTimeout), same reasoning as the poll fix --
  // independently corroborated by a second session's "e2e-env1 CI fix"
  // pass that landed the identical 30_000ms value on `main` for the same
  // reason (a genuine, cross-repo call through PROJEXA's proxy into
  // compliance-tracker's live Supabase project hitting real latency, not a
  // local mock), matching the convention this suite already uses elsewhere
  // (e.g. r81-d603-scope.spec.ts, r90-real-backend-error-in-toast-env1.spec.ts).
  await row.getByRole("button", { name: /^draft$/i }).click();
  await expect(row.getByText(/^drafted$/i), "status badge must read Drafted after the real Draft click").toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: /^submit$/i }).click();
  await expect(row.getByText(/^submitted$/i), "status badge must read Submitted after the real Submit click").toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: /^approve$/i }).click();
  await expect(row.getByText(/client approved/i), "status badge must read Client Approved after the real Approve click").toBeVisible({ timeout: 30_000 });

  // Timeline expansion: the row's own toggle button, then the real timeline
  // steps fetched from GET /api/billing-claims/[id].
  await row.getByRole("button", { name: description }).click();
  const timelineList = row.locator("ul.space-y-1");
  await expect(timelineList, "the real timeline must render after expanding, not stay a spinner").toBeVisible({ timeout: 30_000 });
  await expect(timelineList, "the timeline must name the real stages this spec actually drove the claim through").toContainText(/drafted/i);
  await expect(timelineList).toContainText(/submitted/i);
});

test("Sumeet #3: the create button is disabled with a real reason when the project has no approved BOQ", async ({ page }) => {
  // A project with genuinely zero approved BOQs is required for this
  // negative assertion. Live check this run: Emerald Business Park's own
  // BOQs are all draft/unrelated-spec rows too (same org, confirmed via a
  // direct query at authoring time) -- but that can drift as other specs
  // create/approve their own BOQs against it over time, which would make
  // this test flaky rather than wrong. Guard against that by reading the
  // real boq-analysis report first and only asserting the disabled-button
  // behaviour when boqId is genuinely still null; skip (not fail) otherwise
  // so a sibling spec's leftover approved BOQ never turns this into a false
  // failure.
  const PROJECTS = (await import("./helpers")).PROJECTS;
  const candidate = PROJECTS.emeraldBusinessPark;
  const analysisRes = await page.request.get(`/api/reports/boq-analysis?projectId=${candidate.id}`);
  test.skip(!analysisRes.ok(), "boq-analysis report must be reachable to run this negative check");
  const { row } = await analysisRes.json();
  test.skip(!!row?.boqId, "this project now has an approved BOQ (created by another spec run) -- the no-BOQ case can't be exercised against it anymore");

  await page.goto(`/billing-milestones?projectId=${candidate.id}`, { waitUntil: "networkidle" });
  const newButton = page.getByRole("button", { name: /new billing milestone/i });
  await expect(newButton, "the create button must be disabled, not hidden, when there is no approved BOQ").toBeDisabled();
});
