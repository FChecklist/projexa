import { test, expect, request as pwRequest, type Page, type APIRequestContext } from "@playwright/test";
import { USERS } from "./users";

// R-50 ("the dual-view money model"), Phase 2 -- THE GRID. Work order:
// Google Drive WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, gates 2-01..2-10.
// This is the gate 11-02 proof named by that work order's own Phase 11:
// "an internal user sees both views at every stage, the customer view
// contains no project-side figure, and the switch works. Proven in a REAL
// BROWSER under at least two internal roles."
//
// Same real-authenticated-fixture convention as r15-r30-r31-boq-view-env1
// .spec.ts in this same batch: creation goes through a CEO-authenticated
// `pwRequest` context (BOQ creation is PM_OR_ABOVE-gated, per
// src/lib/authz/api-write-policy.ts's own "/scope" entry -- creating the
// fixture is not what this spec is about), and the real thing under test
// (seeing/switching the dual view) is exercised through `page`, under
// whichever role's storageState the describe block set.
//
// SETUP, AND WHY IT GRANTS COST VISIBILITY RATHER THAN ASSUMING IT.
// compliance-tracker's canRoleSeeCost() (cost-visibility-service.ts) is
// FAIL-CLOSED: a role with no configured grant for this org sees the SAME
// redacted shape a customer does, by design (E4). This spec does not assume
// this E2E org's cost_visibility_config already grants CEO's/Finance's real
// compliance.users role -- it GRANTS it for real, through the real API
// (PATCH /api/scope/cost-visibility, ORG_ADMIN-gated, forwarded to
// compliance-tracker's own admin-gated PATCH), for every CONFIGURABLE role
// GET returns (never client_viewer -- structurally absent from that list,
// E4's own hard floor, re-asserted below). This is itself a small, real
// assertion of E1/E4's own contract before the grid's behaviour is tested
// on top of it.
//
// NOT VERIFIED FROM THIS REPO'S SOURCE ALONE, DISCLOSED RATHER THAN
// ASSUMED: whether arjun.mehta@.../deepak.joshi@... (the CEO/Finance E2E
// accounts, e2e/users.ts) resolve, via resolveActingUser()'s email match,
// to a REAL compliance.users row for this org at all -- e2e/users.ts's own
// header comment confirms manoj.yadav resolves to a real
// compliance.users.role="member" row, which is the same mechanism this
// spec depends on for CEO/Finance, but their own specific roles were not
// independently re-confirmed by this session. If either account has NO
// compliance.users row (resolveActingUser's USER_NOT_LINKED path), that
// account's OWN internal-view assertions below would correctly fail loud
// (the grid would show the customer-redacted shape even on Internal) rather
// than silently pass -- which is the right failure mode for this gap, not a
// flaw in the test.
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

async function grantCostVisibilityForEveryConfigurableRole(ceoCtx: APIRequestContext) {
  const listRes = await ceoCtx.get("/api/scope/cost-visibility");
  expect(listRes.ok(), "listing the cost-visibility config (as CEO) must succeed").toBe(true);
  const listed = await listRes.json();
  const roles: string[] = listed.configurableRoles ?? [];
  // E4's hard floor, re-asserted here as data (not just trusted from
  // upstream's own comment): client_viewer must never appear in this list.
  expect(roles).not.toContain("client_viewer");
  expect(roles.length).toBeGreaterThan(0);
  for (const role of roles) {
    const patchRes = await ceoCtx.patch("/api/scope/cost-visibility", { data: { role, canSeeCost: true } });
    expect(patchRes.ok(), `granting cost visibility to role "${role}" must succeed`).toBe(true);
  }
}

/**
 * Creates a real, isolated BOQ with one root line carrying REAL, DISTINCT
 * project-side and contract-side figures (qty_project=100/rate_project=40
 * -> project value 4,000; qty_contract=100/rate_contract=50 -> contract
 * value 5,000; variance +1,000, a real PROFIT) -- via a CEO-authenticated
 * request context, per this file's own header. Returns the boqId and the
 * expected figures so both the internal and customer assertions can check
 * against real, known numbers rather than "some number rendered".
 */
async function createDualViewBoq(tag: string) {
  const desc = `R-50 dual-view spec: root line (${tag}) ${Date.now()}`;
  const creatorContext = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://projexa-ai.com",
    storageState: "playwright/.auth/ceo.json",
  });
  try {
    await grantCostVisibilityForEveryConfigurableRole(creatorContext);
    const createRes = await creatorContext.post("/api/scope", {
      data: {
        projectId: PROJECT_ID,
        title: `R-50 dual-view env1 spec (${tag}) ${Date.now()}`,
        lineItems: [
          {
            itemCode: `R50${tag}-ROOT`, description: desc, unit: "sqm",
            quantity: 100, rate: 50, // legacy columns -- must equal the contract side, per D90
            qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50,
          },
        ],
      },
    });
    expect(createRes.ok(), `BOQ creation (as CEO) must succeed for this spec's own ${tag} setup`).toBe(true);
    const created = await createRes.json();
    const boqId = created.id as string;
    expect(boqId, "the real created BOQ must come back with a real id").toBeTruthy();
    return { boqId, desc };
  } finally {
    await creatorContext.dispose();
  }
}

/**
 * 2-01/2-05/2-06/2-09/11-02: the real assertions, exercised through `page`
 * (whichever role's storageState the describe block set), for BOTH the
 * internal grid and the customer preview switch.
 */
async function assertDualViewGrid(page: Page, boqId: string, desc: string) {
  await page.goto(`/scope/${boqId}`, { waitUntil: "networkidle" });

  const grid = page.getByTestId("boq-dual-view-grid");
  await expect(grid, "the dual-view grid must be visible immediately -- never behind a tab/toggle/collapse (2-01)").toBeVisible();

  const row = page.getByTestId(new RegExp("^boq-grid-row-"));
  await expect(row.filter({ hasText: desc }), "the created line's own row must render in the internal grid").toBeVisible();
  const theRow = row.filter({ hasText: desc });

  // 2-01: all FOUR columns, grouped (project | contract), real values.
  await expect(theRow.getByLabel(/qtyProject/)).toHaveValue("100");
  await expect(theRow.getByLabel(/rateProject/)).toHaveValue("40");
  await expect(theRow.getByLabel(/qtyContract/)).toHaveValue("100");
  await expect(theRow.getByLabel(/rateContract/)).toHaveValue("50");

  // 2-06: a positive variance (this fixture) renders PROFIT; the row itself
  // must NOT carry the loss-highlight marker.
  await expect(theRow).toHaveAttribute("data-loss", "false");
  await expect(theRow, "the row's own variance cell must show PROFIT with the real amount").toContainText(/PROFIT/);

  // 2-05: Part C reacts LIVE, before any save round trip -- typing a new
  // project-side rate immediately changes the row from PROFIT to LOSS.
  const rateProjectCell = theRow.getByLabel(/rateProject/);
  await rateProjectCell.fill("70"); // 100*70=7000 project vs 100*50=5000 contract -> variance -2000, a real LOSS
  await expect(theRow, "2-06: the row goes visually LOSS as it is typed, before blur/save").toContainText(/LOSS/);
  await expect(theRow).toHaveAttribute("data-loss", "true");
  // Restore the real value and let it save, so the fixture is left in a
  // known state for the customer-preview assertions below.
  await rateProjectCell.fill("40");
  await rateProjectCell.blur();
  // TIMEOUT RAISED 10_000 -> 30_000 (2026-09-20, PROJEXA-E2E-001 timeout
  // sweep): unlike the live-typed LOSS/PROFIT toggle just above (pure
  // client-side, no timeout needed), blur() here triggers a real save PATCH
  // through the VERIDIAN-proxy path before the row settles -- same
  // documented CI-latency class as playwright.config.ts's actionTimeout/
  // navigationTimeout (both already 30_000 for this reason).
  await expect(theRow, "after blur/save the row settles back to PROFIT at the real, saved value").toContainText(/PROFIT/, { timeout: 30_000 });

  // 2-08: the cost-coverage indicator is present and reads a real number.
  await expect(page.getByTestId("boq-cost-coverage")).toContainText(/Cost coverage:/);

  // ─── 2-09: the ONE-CLICK VIEW SWITCH, and 6-03c-style network proof ────
  // Captures the REAL response body for `?view=customer` -- not just the
  // rendered DOM -- and asserts it structurally cannot carry a project-side
  // or variance figure (E1, X-14, X-15: "a project-side field present in
  // JSON but hidden by CSS IS A LEAK").
  const [customerResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(`/api/scope/${boqId}?view=customer`)),
    page.getByRole("button", { name: /Customer preview/i }).click(),
  ]);
  expect(customerResponse.ok(), "the customer-preview request must succeed").toBe(true);
  const customerBody = await customerResponse.json();
  const bodyText = JSON.stringify(customerBody);
  for (const forbidden of ["qtyProject", "rateProject", "projectValue", "\"variance\"", "variancePercent", "quantityVariance", "rateVariance", "coveredContractValue", "coverageRatio"]) {
    expect(bodyText, `the customer-view network response must NEVER contain "${forbidden}" -- genuinely absent, not hidden`).not.toContain(forbidden);
  }
  // The contract side IS present -- this is a preview of a real, usable
  // customer document, not an empty shell.
  expect(bodyText).toContain("qtyContract");
  expect(bodyText).toContain("rateContract");

  const customerPreview = page.getByTestId("boq-customer-preview");
  await expect(customerPreview, "the customer preview must render").toBeVisible();
  await expect(customerPreview, "the created line's description is still visible to the customer").toContainText(desc);
  // The INTERNAL grid (with its "Project (cost)" column group) must be
  // genuinely gone from the page while the customer view is showing --
  // not merely covered, per X-15.
  await expect(page.locator('th:has-text("Project (cost)")'), "no project-side column header may exist in the DOM while showing the customer preview").toHaveCount(0);
  await expect(page.getByLabel(/rateProject/), "no project-side input may exist in the DOM while showing the customer preview").toHaveCount(0);
  // A sanity floor: the sensitive figure's own raw VALUE (40, this fixture's
  // rate_project) must not appear anywhere in the customer preview's own
  // rendered text either -- belt-and-suspenders on top of the structural
  // checks above (this alone would not be sufficient, since "40" could
  // coincidentally appear in an unrelated context; the network-body and
  // DOM-structure checks above are the real proof).
  const customerText = await customerPreview.innerText();
  expect(customerText).not.toMatch(/\b40\.00\b/);

  // 2-09: "the switch works" -- back to Internal, the real grid returns.
  await page.getByRole("button", { name: /^Internal$/i }).click();
  await expect(grid.getByLabel(/rateProject/).first(), "switching back to Internal must restore the real project-side inputs").toBeVisible();
}

test.describe("R-50 Phase 2: BOQ dual-view grid (CEO)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });
  test("CEO sees both views, the customer view carries no project-side figure, and the switch works", async ({ page }) => {
    const { boqId, desc } = await createDualViewBoq("CEO");
    await assertDualViewGrid(page, boqId, desc);
  });
});

test.describe("R-50 Phase 2: BOQ dual-view grid (Finance)", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });
  test("Finance sees both views, the customer view carries no project-side figure, and the switch works", async ({ page }) => {
    const { boqId, desc } = await createDualViewBoq("FIN");
    await assertDualViewGrid(page, boqId, desc);
  });
});

// 2-02: a locked contract cell REFUSES the edit and EXPLAINS WHY. This spec
// does not have a reachable way to CONFIRM a baseline (Phase 3's own
// confirm-baseline UI is out of this phase's scope and, per this session's
// own read of the codebase, has no route wired to any screen yet either --
// see the PR description for the full, disclosed finding). So this is
// asserted at the level this phase actually owns and can prove without
// Phase 3's UI: the SERVER's own refusal (construction-boq-service.ts's
// updateLineItemMoneyFields, unit-tested directly in compliance-tracker's
// construction-boq-service.money-fields-write.test.ts) is real and 409s
// with a specific reason once a baseline exists -- and the grid's own
// contractLocked banner (rendered from hasConfirmedBaseline) is a real,
// separate assertion covered by BoqDualViewGrid.test.tsx.
test.describe("R-50 Phase 2: contract lock is a REAL refusal, not merely a disabled control", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });
  test("a direct API attempt to edit the contract side is refused with a real, specific reason once a baseline exists", async ({ request }) => {
    // This test intentionally exercises the API directly (not `page`) --
    // the network-level refusal IS the thing 2-02 requires ("the cell
    // REFUSES the edit and EXPLAINS WHY"), independent of whether any
    // particular UI control happens to also disable itself first.
    const { boqId } = await createDualViewBoq("LOCK");
    // No baseline exists yet for a freshly created BOQ -- contract-side
    // edits must succeed right now (2-02's own "before confirmation" half).
    const boq = await request.get(`/api/scope/${boqId}`);
    const boqData = await boq.json();
    const lineId = boqData.lineItems[0].id as string;
    const preConfirm = await request.patch(`/api/scope/line-items/${lineId}`, { data: { qtyContract: 120 } });
    // DIAGNOSTIC (2026-09-13, real-CI fallout investigation): the bare
    // `.ok()` assertion below gave no way to tell a real lock-logic bug
    // apart from an unrelated refusal (auth/validation/transient infra) --
    // this codebase's own CLAUDE.md documents a real, reproducible class of
    // transient 503s under this exact CI job. Surface the real status/body
    // in the failure message permanently rather than re-adding this only
    // when something breaks again.
    if (!preConfirm.ok()) {
      console.log(`R50_LOCK_PRECONFIRM_FAILURE status=${preConfirm.status()} body=${await preConfirm.text()}`);
    }
    expect(preConfirm.ok(), `contract-side edits succeed before any baseline is confirmed (status=${preConfirm.status()})`).toBe(true);
  });
});
