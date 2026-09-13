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
  test.setTimeout(120_000);

  // SUPERSEDED 2026-09-13 (R86, second root-cause pass): the "make this
  // spec's own BOQ win the version race" fix directly below (2026-09-13,
  // same day) was itself a real, self-inflicted CI-timeout bug, not a
  // stable fix -- proven live, not guessed: compliance-tracker CI run
  // 34774191857 and BOTH of its first 2 reruns timed out (120s exceeded on
  // a single POST /api/scope/{id}/revisions call) at exactly this loop,
  // because EVERY run of this spec has to out-climb not just whatever
  // existed before it but also every PRIOR run of this same spec (nothing
  // ever revises this shared "Meridian Heights" project back down) -- the
  // project's real max version climbed from 2 (at the first root-cause's
  // investigation time) to 16 in the span of this one CI investigation,
  // confirmed live via the Supabase MCP, with no ceiling. The real fix is
  // upstream: categoryBoqAmountsReport() (compliance-tracker's
  // construction-reports-service.ts) now takes an explicit, ownership-
  // checked `boqId`, threaded through PROJEXA's own
  // /api/projects/[id]/category-distribution route as an optional query
  // param -- this spec no longer needs to WIN anything, it just tells the
  // report which BOQ it means. Zero revision round trips now required.
  const lineItemsPayload = [
    { itemCode: "R33-ROOT", description: "R-33 spec: root line", unit: "sqm", quantity: 10, rate: 500, category: TEST_CATEGORY },
    { itemCode: "R33-SUB", description: "R-33 spec: weighted sub-task", unit: "sqm", quantity: 4, rate: 500, parentItemCode: "R33-ROOT", breakdownPercentage: 40, category: TEST_CATEGORY },
  ];

  const createRes = await page.request.post("/api/scope", {
    data: { projectId: PROJECT_ID, title: `R-33 env1 spec ${RUN_TAG}`, lineItems: lineItemsPayload },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const created: { id: string; lineItems: Array<{ itemCode: string; amount: number | string }> } = await createRes.json();

  const rootLine = created.lineItems.find((l) => l.itemCode === "R33-ROOT");
  expect(rootLine, "the real root line must come back from the create response").toBeTruthy();
  const rootAmount = Number(rootLine!.amount);
  expect(rootAmount, "the root line's real stored amount must be a positive number").toBeGreaterThan(0);

  // Real authenticated read of the real category-distribution report,
  // explicitly targeting THIS spec's own just-created BOQ -- see the
  // superseded-root-cause note above for why an implicit "whatever's
  // currently active" read is no longer used here.
  const distRes = await page.request.get(`/api/projects/${PROJECT_ID}/category-distribution?boqId=${created.id}`);
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
