import { test, expect } from "@playwright/test";

// R-42 (Work Progress): "Previous Qty / Current Qty / Total Qty columns".
// Recorded closure_state=BLOCKED, same shared root cause as R-41 (see that
// spec's header) -- part of the eleven in F-2026-0910-PM-068. Grounded
// directly in source: WorkProgressReportClient.tsx's ScopeTable renders a
// "Quantity" header band (colSpan=3) with "Previous" / "Current" / third-label
// sub-headers, and each data row carries data-testid="qty-prev" /
// "qty-current" / "qty-third" cells (unlike percent, these render for BOTH
// parent and child rows -- WPR-14: qty/amt are the row's own, not
// parent-only).
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-41.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Same real, live project as R-41's spec (7 real progress entries, confirmed
// 2026-09-10).
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-42: Previous Qty, Current Qty and Total Qty columns render real values, against a real project", async ({ page }) => {
  await page.goto(`/work-progress?tab=report&projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });

  const runButton = page.getByRole("button", { name: /run report/i });
  if (await runButton.isVisible().catch(() => false)) {
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the report must show a Quantity column band").toContain("Quantity");

  // D58 falsifiability note (manual break-restore, not yet run -- see R-41's
  // spec header for the pipeline status this shares): planting a defect means
  // temporarily hardcoding qty-prev/qty-current/qty-third to "" in
  // WorkProgressReportClient.tsx, confirming this goes red, then reverting.
  const qtyPrev = page.locator('[data-testid="qty-prev"]').first();
  await expect(qtyPrev, "at least one real Previous Qty cell must be present").toBeVisible();
  // Qty cells render for every row (not parent-only like percent), so row 1's
  // own cell is asserted directly rather than unioned across rows.
  const prevText = (await qtyPrev.textContent()) ?? "";
  const currentText = (await page.locator('[data-testid="qty-current"]').first().textContent()) ?? "";
  const thirdText = (await page.locator('[data-testid="qty-third"]').first().textContent()) ?? "";
  expect(prevText + currentText + thirdText, "the first row's quantity cells must not all be empty").not.toBe("");
});
