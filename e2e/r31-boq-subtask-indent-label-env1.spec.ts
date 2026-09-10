import { test, expect } from "@playwright/test";

// R-31 (BOQ View): "Sub-task rows indented and labelled % of parent".
// Recorded closure_state=BLOCKED, same shared root cause as R-30 (see that
// spec's header) -- part of the eleven in F-2026-0910-PM-068.
//
// Grounded directly in source, not guessed: src/components/ScopeObjectClient.tsx's
// line-items table renders a sub-task's description cell with
// `className={isSub ? "pl-8 text-ct-muted" : ...}` (the indent) and, when
// isSub && r.breakdownPercentage, an inline `{r.breakdownPercentage}% of
// parent` label right next to the description.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-30/R-60.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Same real, live BOQ as R-30's spec: R81-SUB-A is 40% of its parent,
// R81-SUB-B is 35% of its parent (compliance.construction_boq_line_items,
// breakdown_percentage columns, confirmed live 2026-09-10).
const BOQ_ID = "uaxct0zlk2mrcn1jxswsqw1a";

test("R-31: sub-task rows are indented and labelled with their own % of parent, against a real BOQ", async ({ page }) => {
  await page.goto(`/scope/${BOQ_ID}`, { waitUntil: "networkidle" });

  // D58 falsifiability note (manual break-restore, not yet run -- see header):
  // planting a defect means temporarily deleting the `isSub && "% of parent"`
  // branch in ScopeObjectClient.tsx, confirming this assertion goes red, then
  // reverting.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "R81-SUB-A's own 40% breakdown must be labelled as % of its parent").toMatch(/40%\s*of parent/i);
  expect(bodyText, "R81-SUB-B's own 35% breakdown must be labelled as % of its parent").toMatch(/35%\s*of parent/i);

  // The indentation itself: the sub-task description cell carries the "pl-8"
  // class ScopeObjectClient.tsx applies only to isSub rows (the non-sub root
  // row uses "font-medium text-ct-navy" instead, per source).
  const subRow = page.locator("td", { hasText: "R81 fixture SUB-A - plaster" });
  await expect(subRow, "the sub-task's own description cell must carry the indentation class").toHaveClass(/pl-8/);
});
