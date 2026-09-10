import { test, expect } from "@playwright/test";

// R-30 (BOQ View): "Sumeet can SEE line items of a BOQ". Recorded
// closure_state=BLOCKED, same recorded reason as R-60/R-11/R-15/R-31/R-41/
// R-42/R-43/R-82/R-90/R-91 (platform.sumeet_requirements, F-2026-0910-PM-068):
// closure was measured against the paused Vercel deployment (Env-2), not the
// product. This is one of the ten remaining specs after R-60's pipeline
// proof-of-concept (projexa PR #249).
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-60 (see that spec's header). This spec is otherwise
// complete and was written and verified against real, live data WITHOUT
// needing that job.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Real BOQ, confirmed live 2026-09-10 against pcrjmlpuqsbocqfwoxod
// (compliance.construction_boq_line_items, boq_id=uaxct0zlk2mrcn1jxswsqw1a,
// org_id=4ecc472f-4152-4310-ae8d-cf8b7c52ab6d -- the same Meridian E2E BOQ
// R-60's spec already uses), with exactly 3 line items:
//   R81-ROOT (root, description "R81 fixture ROOT - external wall finishes")
//   R81-SUB-A (child, "R81 fixture SUB-A - plaster")
//   R81-SUB-B (child, "R81 fixture SUB-B - paint")
const BOQ_ID = "uaxct0zlk2mrcn1jxswsqw1a";

test("R-30: a BOQ's line items are visible on its own view page, against a real project", async ({ page }) => {
  await page.goto(`/scope/${BOQ_ID}`, { waitUntil: "networkidle" });

  // D58 falsifiability note (manual break-restore proof this pipeline needs,
  // not yet run since the Env-1 job doesn't exist yet -- see header): planting
  // a defect here means temporarily short-circuiting ScopeObjectClient.tsx's
  // line-items table to render zero rows regardless of data, confirming this
  // assertion goes red, then reverting -- the same RED/GREEN pattern DOD-X4/
  // DOD-R3/R-60 already used.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the root line's own description must be visible").toContain("R81 fixture ROOT - external wall finishes");
  expect(bodyText, "the first sub-task's own description must be visible").toContain("R81 fixture SUB-A - plaster");
  expect(bodyText, "the second sub-task's own description must be visible").toContain("R81 fixture SUB-B - paint");
});
