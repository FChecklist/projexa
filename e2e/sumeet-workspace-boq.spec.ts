import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Sumeet Merge 6 -- BOQ embed inside /workspace/[id]#boq.
//
// SCOPE. This file is NOT a re-derivation of BOQ business logic -- every one
// of the requirement IDs below is already CLOSED against the BOQ's own
// standalone screens (/scope, /scope/[id], /scope/new) in PRs #287-290, with
// their own committed specs (see the file names cited below). This file's
// only job is to prove that EMBEDDING BoqDualViewGrid.tsx inside the new
// workspace page (via src/components/workspace/WorkspaceBoqCard.tsx) did not
// break any of it -- real data, real amounts, real sub-task
// indentation/percentages, real AED formatting, and the real
// internal/customer dual-view redaction, all rendering correctly inside
// `#boq` on `/workspace/<id>`.
//
// WHAT'S ACTUALLY EMBEDDED, CONFIRMED BY DIRECT READ (not assumed):
// ProjectWorkspaceClient.tsx's `#boq` section renders ONLY
// `<WorkspaceBoqCard projectId={project.id} />` inside a generic
// `<CardTitle>BOQ</CardTitle>` header -- it does NOT render
// ScopeObjectClient.tsx's "legacy" grid (the one r15-r30-r31-boq-view-env1
// .spec.ts's own `boq-legacy-detail-grid` testid targets, with its
// budget/vendor columns) at all. WorkspaceBoqCard resolves the project's
// current BOQ id via GET /api/reports/boq-analysis?projectId=, then renders
// BoqDualViewGrid.tsx directly and unconditionally (no wrapper title/status
// of its own) -- confirmed by reading both files in full.
//
// SURPRISING FINDING #1 (worth flagging, not silently working around): the
// task brief for this file assumed the embed would show "real title/status".
// It does not -- BoqDualViewGrid's own `DualViewBoq` type carries a `status`
// field but never renders it anywhere in the component, and it has no
// concept of a BOQ "title" at all (that lives only on ScopeObjectClient.tsx's
// page, which this embed does not use). The only title-shaped text inside
// `#boq` is the section's own generic "BOQ" CardTitle, not this specific
// BOQ's title. So R-01/R-03/R-30 below are proven via real LINE ITEM
// rendering and a real, direct API save, not via a title/status assertion
// this component does not have.
//
// SURPRISING FINDING #2 (a real, disclosed gap, not asserted as a hard
// failure below -- see the client_viewer test's own comment): BoqDualViewGrid
// takes no `role` prop and has no client-side role awareness at all. It
// always renders all four column headers ("Project (cost)" / "Contract
// (customer)") and all four aria-labelled <Input>s (`aria-label={`${field}
// for ${description}`}`, GridRow's `cell()`, ~L536-557) regardless of who is
// looking -- it relies ENTIRELY on the server having already blanked
// qtyProject/rateProject to null for a role whose cost-visibility check
// fails (confirmed: cost-visibility-service.ts is fail-closed per the
// existing r50-boq-dual-view-grid-env1.spec.ts's own header comment, and
// client_viewer is structurally absent from `configurableRoles` -- it can
// never be granted cost visibility). So a client_viewer's "Internal" view
// still shows the Project-side COLUMNS and LABELS, just with blank/NOT_SET
// project-side values -- not the fully customer-only shape the task brief
// assumed as one of two possible outcomes ("never sees the toggle at all, OR
// always lands on the customer-only shape"). Neither branch is exactly what
// happens; this file's client_viewer test therefore checks the property that
// actually matters (no REAL project-side VALUE ever renders) rather than a
// structural absence this session cannot confirm will hold.
//
// REQUIREMENTS NOT REACHABLE FROM `/workspace/[id]` -- DECLARED, NOT
// FABRICATED. These are all about the BOQ CREATE/EDIT form or its revision
// workflow (/scope/new, /scope/[id]'s own revision actions), which the
// read-mostly workspace embed has no UI for at all -- WorkspaceBoqCard shows
// only the resolved CURRENT BOQ's dual-view grid, with no create/edit/revise
// control anywhere in it. Each already has its own committed spec against
// the real form:
//   R-04  Missing title rejected, naming the field       -> BOQ create form (/scope/new); not exercised here.
//   R-10  Sub-task columns exist in production DB          -> a DB-schema fact, not a UI/browser concern at all.
//   R-11  Sub-task enterable in create form                -> e2e/r11-boq-create-form-subtask-fields-env1.spec.ts
//   R-12  Sub-task amount = ROOT qty x ROOT rate x %        -> create-time computation; BoqDualViewGrid never shows a
//                                                              sub-task's own "amount" at all (only "excluded from the
//                                                              money model" -- see R-31/R-32/R-33 below, which ARE
//                                                              exercised here since that IS what this grid shows).
//   R-13  Sub-task's own QTY/RATE ignored                   -> create-time rule; same create-form suite as R-11.
//   R-14  Weights NOT forced to sum to 100                  -> create-time validation.
//   R-16  Child with parent but no percentage rejected      -> create-time validation.
//   R-17  Parent code matching nothing rejected             -> create-time validation.
//   R-18  Circular reference rejected without hanging       -> create-time validation.
//   R-19  Nested sub-task prices off the ROOT                -> multi-level create-time computation.
//   R-20  Revision preserves parent links and breakdown %   -> e2e/sumeet-boq-revision-env1.spec.ts
//   R-21  Revision variation vs prior shown                 -> e2e/r21-r24-boq-compare-variation-and-percentage-change-env1.spec.ts
//   R-22  Removing a line WITH progress is BLOCKED          -> e2e/r22-boq-revision-remove-progressed-line-blocked-env1.spec.ts
//   R-23  Reducing qty on a line WITH progress is BLOCKED   -> e2e/r23-c13-boq-revision-reduce-qty-progressed-line-blocked-env1.spec.ts
//   R-24  Percentage-only change detected as variation       -> same r21-r24 spec as R-21.
// None of the above get a workspace-page test in this file.
//
// FIXTURE STRATEGY, AND WHY IT SUBMITS+APPROVES (a real product action, not a
// test-only hack). WorkspaceBoqCard does not let a caller pick which BOQ to
// show -- it always resolves the project's CURRENT BOQ via
// /api/reports/boq-analysis?projectId=. Reading the existing
// r33-category-rollup-excludes-subtasks-env1.spec.ts / r15-r30-r31 / r50
// specs in this same suite confirms none of them ever call
// submit/approve on the BOQs they create -- they view a SPECIFIC boqId
// directly via /scope/[id], which does not need "current" resolution at
// all. This file's fixture is the first in the batch that genuinely needs
// to become "the" resolved BOQ for this project, so it goes through the
// real submit -> approve workflow (POST /api/scope/[id]/submit,
// POST /api/scope/[id]/approve) the same way a real user would -- per
// src/lib/boq-lineage.ts's own comment ("the latest APPROVED revision ... or
// the latest of any status when none is approved"), the most recently
// approved BOQ for a project is the one a resolution like this should pick.
// NOT independently observed by this session (this session was told not to
// run Playwright/dev-server commands -- another session runs this suite
// centrally). If resolution turns out to work differently, the setup step's
// own descriptive expect() messages below will fail loudly and specifically,
// not silently render nothing.
const PROJECT_ID = DEFAULT_PROJECT.id;

const RUN_TAG = Date.now();
const ROOT_ITEM_CODE = `WSBOQ-ROOT-${RUN_TAG}`;
const SUB_ITEM_CODE = `WSBOQ-SUB-${RUN_TAG}`;
const ROOT_DESC = `Workspace BOQ embed spec: root line ${RUN_TAG}`;
const SUB_DESC = `Workspace BOQ embed spec: weighted sub-task ${RUN_TAG}`;

// Whole numbers throughout -- avoids depending on how the backend
// (a separate repo, compliance-tracker) round-trips a decimal numeric
// column's string form, the same reason r50-boq-dual-view-grid-env1.spec.ts
// picked 100/40/100/50 rather than anything with a fractional part.
const QTY_PROJECT = 13;
const RATE_PROJECT = 341; // a deliberately unusual number, unlikely to appear elsewhere on the page by coincidence
const QTY_CONTRACT = 13;
const RATE_CONTRACT = 475;
const BREAKDOWN_PCT = 35;

const EXPECTED_PROJECT_VALUE = QTY_PROJECT * RATE_PROJECT; // 4,433
const EXPECTED_CONTRACT_VALUE = QTY_CONTRACT * RATE_CONTRACT; // 6,175
const EXPECTED_VARIANCE = EXPECTED_CONTRACT_VALUE - EXPECTED_PROJECT_VALUE; // 1,742 (a real PROFIT)

/** Same formatting rule as src/lib/format-money.ts's formatMoney: "AED " + en-US, 2 decimals, grouped. */
function aed(n: number): string {
  return `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A percentage as it should appear in the UI, tolerant of an unverified decimal tail -- same helper as r15-r30-r31-boq-view-env1.spec.ts. */
function pctPattern(value: number): string {
  return `${value}(\\.\\d+)?`;
}

// Copied from r50-boq-dual-view-grid-env1.spec.ts's own helper of the same
// name/purpose: cost-visibility-service.ts is fail-closed, so even the CEO
// account sees the redacted (customer) shape on "Internal" until this org's
// cost-visibility config explicitly grants each configurable role. Not
// merged into a shared module -- kept local, matching that file's own
// precedent of not sharing this across spec files.
async function grantCostVisibilityForEveryConfigurableRole(ctx: APIRequestContext) {
  const listRes = await ctx.get("/api/scope/cost-visibility");
  expect(listRes.ok(), "listing the cost-visibility config (as CEO) must succeed").toBe(true);
  const listed = await listRes.json();
  const roles: string[] = listed.configurableRoles ?? [];
  expect(roles).not.toContain("client_viewer");
  expect(roles.length).toBeGreaterThan(0);
  for (const role of roles) {
    const patchRes = await ctx.patch("/api/scope/cost-visibility", { data: { role, canSeeCost: true } });
    expect(patchRes.ok(), `granting cost visibility to role "${role}" must succeed`).toBe(true);
  }
}

let fixtureBoqId: string | null = null;

// Runs once for the whole file (playwright.config.ts has `fullyParallel:
// false`, so every test in one file runs sequentially in the same worker --
// safe to create this fixture exactly once and share its boqId across the
// owner-role and client_viewer-role tests below, the same real data both
// roles are viewing).
test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://projexa-ai.com",
    storageState: "playwright/.auth/ceo.json",
  });
  try {
    await grantCostVisibilityForEveryConfigurableRole(ctx);

    const createRes = await ctx.post("/api/scope", {
      data: {
        projectId: PROJECT_ID,
        title: `Workspace BOQ embed spec ${RUN_TAG}`,
        lineItems: [
          {
            itemCode: ROOT_ITEM_CODE,
            description: ROOT_DESC,
            unit: "sqm",
            // legacy quantity/rate must equal the contract side, per D90 --
            // same convention r50-boq-dual-view-grid-env1.spec.ts's own
            // fixture follows.
            quantity: QTY_CONTRACT,
            rate: RATE_CONTRACT,
            qtyProject: QTY_PROJECT,
            rateProject: RATE_PROJECT,
            qtyContract: QTY_CONTRACT,
            rateContract: RATE_CONTRACT,
          },
          {
            itemCode: SUB_ITEM_CODE,
            description: SUB_DESC,
            unit: "sqm",
            quantity: 5,
            rate: RATE_CONTRACT,
            parentItemCode: ROOT_ITEM_CODE,
            breakdownPercentage: BREAKDOWN_PCT,
          },
        ],
      },
    });
    expect(createRes.ok(), "BOQ creation must succeed for this spec's own fixture setup (R-01)").toBe(true);
    const created = await createRes.json();
    fixtureBoqId = created.id as string;
    expect(fixtureBoqId, "the real created BOQ must come back with a real id").toBeTruthy();

    const rootLine = (created.lineItems as Array<{ itemCode: string; amount: number | string }>).find(
      (l) => l.itemCode === ROOT_ITEM_CODE
    );
    expect(rootLine, "the real root line must come back from the create response").toBeTruthy();
    // R-02: the stored amount is quantity * rate, read straight from the
    // create response -- independent of anything BoqDualViewGrid itself
    // later computes client-side.
    expect(Number(rootLine!.amount), "the root line's stored amount must equal quantity * rate (R-02)").toBeCloseTo(
      QTY_CONTRACT * RATE_CONTRACT,
      2
    );

    const submitRes = await ctx.post(`/api/scope/${fixtureBoqId}/submit`);
    expect(submitRes.ok(), "submitting this fixture BOQ for approval must succeed").toBe(true);
  } finally {
    await ctx.dispose();
  }

  // REAL FINDING, not a bug: construction-boq-service.ts's own
  // isSelfApproval() check refuses "You cannot approve a BOQ you created
  // yourself -- an independent approver is required" (403) -- a genuine
  // segregation-of-duties rule, not a defect. This fixture created and
  // submitted the BOQ as CEO (owner), so approval needs a DIFFERENT real
  // user; the pm fixture (Deepak Joshi, finance.json) is the established
  // approver in this org's other fixtures.
  const approverCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://projexa-ai.com",
    storageState: "playwright/.auth/finance.json",
  });
  try {
    const approveRes = await approverCtx.post(`/api/scope/${fixtureBoqId}/approve`);
    expect(approveRes.ok(), "approving this fixture BOQ (as a DIFFERENT user than its creator) must succeed -- this is what makes it the project's CURRENT BOQ (see file header)").toBe(true);
  } finally {
    await approverCtx.dispose();
  }
});

test.describe("Sumeet Merge 6: BOQ section (#boq) embeds the real BoqDualViewGrid, owner role", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("real line items render inside #boq with correct project/contract amounts, sub-task indentation/exclusion, and AED currency (R-01/R-02/R-03/R-30/R-31/R-32/R-33/R-60/R-62/R-93)", async ({ page }) => {
    expect(fixtureBoqId, "the file-level fixture must have been created in beforeAll").toBeTruthy();

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const boqSection = page.locator("#boq");
    // Sections mount lazily (LazyMount, IntersectionObserver-based) -- scroll
    // to it first, same as every other reused-component test in
    // sumeet-project-workspace-env1.spec.ts already does.
    await boqSection.scrollIntoViewIfNeeded();

    const grid = boqSection.getByTestId("boq-dual-view-grid");
    await expect(grid, "the real BoqDualViewGrid must render inside #boq, not a placeholder or the legacy grid").toBeVisible();

    // R-30: the fixture's own root line renders as its own real row.
    const row = boqSection.getByTestId(new RegExp("^boq-grid-row-")).filter({ hasText: ROOT_DESC });
    await expect(row, "the fixture's root line must render as its own row inside the workspace-embedded grid").toBeVisible();

    // R-93: BOQ tracks four variables as two DISTINCT pairs -- both pairs
    // render together in the internal view, not merged into one, and not
    // only one of the two shown.
    await expect(row.getByLabel(/qtyProject/), "the project-side quantity must render (R-93 pair 1)").toHaveValue(String(QTY_PROJECT));
    await expect(row.getByLabel(/rateProject/), "the project-side rate must render (R-93 pair 1)").toHaveValue(String(RATE_PROJECT));
    await expect(row.getByLabel(/qtyContract/), "the contract-side quantity must render (R-93 pair 2)").toHaveValue(String(QTY_CONTRACT));
    await expect(row.getByLabel(/rateContract/), "the contract-side rate must render (R-93 pair 2)").toHaveValue(String(RATE_CONTRACT));

    // R-02 (a second, independent proof beyond the create-response check in
    // beforeAll): the row's own variance is contractValue - projectValue,
    // which is only correct if BOTH qty*rate multiplications were applied
    // correctly to the fixture's real, known numbers.
    await expect(row, "a positive variance renders PROFIT at the fixture's real numbers").toContainText(/PROFIT/);
    await expect(row, `the row's own variance must equal contractValue - projectValue = ${aed(EXPECTED_VARIANCE)}`).toContainText(
      aed(EXPECTED_VARIANCE)
    );

    // R-31: the sub-task's own real cell carries the real pl-8 indentation
    // class and its own real "X% of parent" label.
    const subCell = boqSection.locator("td.pl-8", { hasText: SUB_DESC });
    await expect(subCell, "the sub-task's own cell must carry the real pl-8 indentation class (R-31)").toBeVisible();
    await expect(subCell, "the sub-task must be labelled with its own real % of parent (R-31)").toContainText(
      new RegExp(`${pctPattern(BREAKDOWN_PCT)}% of parent`)
    );
    const subRow = boqSection.locator("tr", { hasText: SUB_DESC });
    await expect(subRow, "the sub-task's own row states it is excluded from the money model (R-32/R-33)").toContainText(
      /excluded from the money model/
    );

    // R-32/R-33: the BOQ's OWN total (Part C) counts the root line's amount
    // alone -- if the sub-task's own derived share were double-counted, this
    // would be materially higher than the root's contract/project value.
    const partC = page.getByTestId("boq-part-c-block");
    await expect(partC, "Part C's contract value must equal the ROOT line's contract value alone (R-32/R-33)").toContainText(
      aed(EXPECTED_CONTRACT_VALUE)
    );
    await expect(partC, "Part C's project value must equal the ROOT line's project value alone (R-32/R-33)").toContainText(
      aed(EXPECTED_PROJECT_VALUE)
    );

    // R-60/R-62: AED, never rupee, inside the embedded card specifically
    // (scoped to #boq, not the whole page, so an unrelated rupee/AED mention
    // elsewhere on the page cannot produce a false pass or false fail here).
    const boqText = await boqSection.innerText();
    expect(boqText, "the BOQ card must show at least one AED-denominated amount").toMatch(/AED/);
    expect(boqText, "the BOQ card must never show a rupee symbol or INR code").not.toMatch(/₹|INR\b/);
  });
});

test.describe("Sumeet Merge 6: BOQ creation edge cases (direct API, not workspace-page-specific)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  // R-03: kept separate from the main render test above, since a title-only,
  // zero-line BOQ has nothing to render inside #boq -- the requirement is
  // just that the SAVE itself is allowed, which is a direct, isolated API
  // assertion, the same class of check r33/r50's own fixture-creation steps
  // already rely on without additionally re-proving through the UI.
  test("a BOQ with a title and zero line items is allowed to save (R-03)", async ({ request }) => {
    const res = await request.post("/api/scope", {
      data: { projectId: PROJECT_ID, title: `Workspace BOQ embed spec: title-only zero-line ${RUN_TAG}`, lineItems: [] },
    });
    expect(res.ok(), "a BOQ with a title and NO line items must save without a server error (R-03)").toBe(true);
  });
});

test.describe("Sumeet Merge 6: BOQ section (#boq) under client_viewer -- no project-side value leaks (R-50, re-verified via rendered UI)", () => {
  test.use({ storageState: "playwright/.auth/clientViewer.json" });

  test("client_viewer's #boq card never renders a real project-side number, even though the grid's own column/label structure is not itself role-gated", async ({ page }) => {
    expect(fixtureBoqId, "the file-level fixture must have been created in beforeAll").toBeTruthy();

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const boqSection = page.locator("#boq");
    await boqSection.scrollIntoViewIfNeeded();

    // The real, load-bearing check: the fixture's own real, distinctive
    // project-side rate (341, chosen specifically so it is unlikely to
    // coincidentally appear anywhere else in this card) must never appear as
    // rendered text anywhere inside #boq for client_viewer -- whether in an
    // <Input>'s value, a label, or any other text node.
    const boqText = await boqSection.innerText();
    expect(
      boqText,
      `client_viewer must never see the real project-side rate (${RATE_PROJECT}) rendered anywhere in the BOQ card (R-50)`
    ).not.toMatch(new RegExp(`\\b${RATE_PROJECT}\\b`));

    // The same check at the control level: IF a qtyProject/rateProject-
    // labelled control exists in the DOM at all (see the file header's
    // "Surprising finding #2" -- BoqDualViewGrid is not role-aware and does
    // not itself remove these controls; the server is what blanks their
    // VALUE), that control must never carry the real, known project-side
    // number. This is deliberately a value check, not a `toHaveCount(0)`
    // presence check -- per the file header, this session's direct read of
    // BoqDualViewGrid.tsx found no code path that would remove these
    // controls from the DOM for any role, so a presence-based assertion
    // would very likely fail here for a reason unrelated to R-50's actual
    // concern (whether a real number leaks), which is the property this test
    // exists to guard.
    const projectFieldInputs = boqSection.getByLabel(/qtyProject|rateProject/i);
    const projectFieldCount = await projectFieldInputs.count();
    for (let i = 0; i < projectFieldCount; i++) {
      const input = projectFieldInputs.nth(i);
      await expect(input, "no qtyProject/rateProject-labelled control may carry the real project-side quantity (R-50)").not.toHaveValue(
        String(QTY_PROJECT)
      );
      await expect(input, "no qtyProject/rateProject-labelled control may carry the real project-side rate (R-50)").not.toHaveValue(
        String(RATE_PROJECT)
      );
    }
  });
});
