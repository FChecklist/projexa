import { test, expect } from "@playwright/test";

// R-33 (Reports Roll-up): "BACKEND roll-up excludes sub-tasks". Recorded
// route: "dashboard + category report", file_path: "compliance-tracker
// src/lib/services/construction-reports-service.ts L112 helper, L127, L667".
// Confirmed by direct read: rollUpLinesByCategory()'s own doc comment states
// the rule plainly -- "a weighted sub-task's amount is derived from its root
// ancestor's qty x rate x breakdown %, so the root row already carries the
// full value and summing both double-counts. Child rows are still RETURNED
// ... and still counted in lineCount, they just contribute 0 to the
// subtotal." The SAME rootBoqLineItemsOnly discipline backs
// categoryBoqAmountsReport(), which is what actually feeds the real route
// this spec drives: GET /api/projects/[id]/category-distribution ->
// ct's /reports/category-boq-amounts -> categoryBoqAmountsReport().
//
// NOT A REFUSAL/GUARD requirement, unlike R-22/R-23/R-C13 -- there is
// nothing to block here. This is a computed-VALUE correctness requirement
// (the same category as R-21/R-24, adapted the same way, per this window's
// scoping message to the PM).
//
// EXIT CONDITIONS:
//  1. Real user action: this spec creates its own real, isolated BOQ (a
//     distinctive category name avoids depending on -- or being polluted by
//     -- whatever else already exists in this shared project's real data)
//     with a root line and one weighted sub-task line, via real authenticated
//     API calls, then reads the real category-distribution report the
//     project dashboard's own chart calls.
//  2. Asserts the REAL computed category total equals the ROOT line's own
//     real amount alone -- not root+child, which would be the double-count
//     defect this requirement exists to catch.
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION. Same RAM/CI blocker as
//     the rest of this batch (0.62GB free at write time, D72, no Env-1 CI job
//     yet). Plant/revert procedure: in rollUpLinesByCategory() (and/or
//     categoryBoqAmountsReport(), construction-reports-service.ts), remove
//     the "child rows contribute 0" guard so a child's own derived amount is
//     summed into the subtotal alongside its root -- confirm this spec's
//     assertion goes red (category total becomes root+child, not root alone),
//     then revert and confirm green again.
//  4. Runs against Env-1 -- blocked from actually running until the CI job
//     exists, same as condition 3.
test.use({ storageState: "playwright/.auth/ceo.json" });

const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";
const TEST_CATEGORY = `R33 Spec Category ${Date.now()}`;
const RUN_TAG = Date.now();

test("R-33: a category's roll-up total counts a root line once, never its sub-task's share again", async ({ page }) => {
  // This spec now makes several extra real round trips (a list read plus
  // possibly more than one revision, see below) on top of its original
  // create + report-read pair, against a backend whose real per-call
  // upstream latency this same investigation measured averaging 4.5s with a
  // 29.5s tail (see the root-cause note just below) -- the config's default
  // 75s test timeout leaves too little margin for that stacked up.
  test.setTimeout(120_000);

  // ROOT-CAUSED 2026-09-13 (env1 CI fix pass): the real CI failure
  // (compliance-tracker run 34758516701 / job 103727532493, 2026-09-13,
  // "Received: undefined" -- this spec's own category simply never appeared)
  // was NOT a caching gap. categoryBoqAmountsReport() (compliance-tracker's
  // construction-reports-service.ts:2597-2612) has NO boqId parameter at
  // all -- it always picks exactly ONE BOQ for the whole project via
  // `orderBy: desc(version), desc(createdAt)`, and this shared project
  // ("Meridian Heights") is a real, live fixture every env1 spec in this
  // suite writes into with nothing cleaning it up between runs. Confirmed
  // directly via the Supabase MCP at investigation time: 240 real BOQ rows
  // for this exact project_id, with max(version)=2 -- and createBoq() always
  // stores a fresh, independent BOQ at version:1
  // (construction-boq-service.ts:1228), while createBoqRevision() bumps
  // version:+1 (line 1291). Because the sort key is version FIRST, ANY
  // existing non-superseded version-2+ row in this project permanently
  // outranks a brand-new version-1 BOQ, no matter how recent -- this was not
  // a timing race, it was a deterministic loss every run makes against
  // whatever earlier spec (in this batch, r21-r24 and friends) already
  // created a revision here. There is no PROJEXA-side API parameter to work
  // around this (the report endpoint genuinely has none), so the fix is to
  // make THIS spec's own BOQ win the same real ordering rule the backend
  // uses: read the project's current max version first, then bump this
  // spec's own BOQ with real revisions (the same mechanism
  // r21-r24-boq-compare-variation-and-percentage-change-env1.spec.ts already
  // uses for an unrelated reason) until its version exceeds it. Computed at
  // runtime rather than hardcoded, so this stays correct as the shared
  // project's real max version keeps growing across future runs.
  const existingRes = await page.request.get(`/api/scope?projectId=${PROJECT_ID}`);
  expect(existingRes.ok(), "listing this project's existing BOQs for this spec's own version-disambiguation setup must succeed").toBe(true);
  const existingBoqs: Array<{ version?: number | string }> = (await existingRes.json()).boqs ?? [];
  const maxExistingVersion = existingBoqs.reduce((m, b) => Math.max(m, Number(b.version) || 0), 0);

  const lineItemsPayload = [
    { itemCode: "R33-ROOT", description: "R-33 spec: root line", unit: "sqm", quantity: 10, rate: 500, category: TEST_CATEGORY },
    { itemCode: "R33-SUB", description: "R-33 spec: weighted sub-task", unit: "sqm", quantity: 4, rate: 500, parentItemCode: "R33-ROOT", breakdownPercentage: 40, category: TEST_CATEGORY },
  ];

  const createRes = await page.request.post("/api/scope", {
    data: { projectId: PROJECT_ID, title: `R-33 env1 spec ${RUN_TAG}`, lineItems: lineItemsPayload },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  let created: { id: string; version?: number | string; lineItems: Array<{ itemCode: string; amount: number | string }> } = await createRes.json();

  // Bump this spec's own BOQ past whatever else currently exists in the
  // shared project -- see the root-cause note above. Each revision resubmits
  // the SAME two lines (their content is irrelevant beyond winning the
  // version race and producing a positive root amount), and the loop
  // terminates deterministically since version strictly increases by 1 each
  // pass while maxExistingVersion is fixed at the value read before setup
  // began (nothing else runs concurrently under this suite's workers=1 CI
  // config).
  while (Number(created.version ?? 1) <= maxExistingVersion) {
    const revRes = await page.request.post(`/api/scope/${created.id}/revisions`, {
      data: { title: `R-33 env1 spec ${RUN_TAG} (v${Number(created.version ?? 1) + 1})`, lineItems: lineItemsPayload },
    });
    expect(revRes.ok(), "bumping this spec's own BOQ past the project's current max version must succeed").toBe(true);
    created = await revRes.json();
  }

  const rootLine = created.lineItems.find((l) => l.itemCode === "R33-ROOT");
  expect(rootLine, "the real root line must come back from the create response").toBeTruthy();
  const rootAmount = Number(rootLine!.amount);
  expect(rootAmount, "the root line's real stored amount must be a positive number").toBeGreaterThan(0);

  // Real authenticated read of the real category-distribution report -- the
  // same request the project dashboard's category chart issues.
  const distRes = await page.request.get(`/api/projects/${PROJECT_ID}/category-distribution`);
  expect(distRes.ok(), "the real category-distribution endpoint must succeed").toBe(true);
  const dist = await distRes.json();
  const categories: Array<{ name: string; totalAmount: number }> = dist.categories ?? [];
  const testCategoryEntry = categories.find((c) => c.name === TEST_CATEGORY);
  expect(testCategoryEntry, "this spec's own distinctively-named category must appear in the real report").toBeTruthy();

  // The load-bearing assertion: the category total is the ROOT's amount
  // alone. If the sub-task's own derived share were double-counted, this
  // would be materially higher (root + child, not root).
  expect(
    testCategoryEntry!.totalAmount,
    "the category total must equal the root line's amount alone, not root+sub-task (no double-counting)"
  ).toBeCloseTo(rootAmount, 2);
});
