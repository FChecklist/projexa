import { test, expect } from "@playwright/test";

// R-43 (Work Progress): "Cum Amt / Current Amt / Balance Amt columns".
// Recorded closure_state=BLOCKED, same shared root cause as R-41/R-42 (see
// R-41's spec header) -- part of the eleven in F-2026-0910-PM-068. The
// requirement's own wording ("Balance Amt", not "Total Amt") names the
// "balance" mode specifically, so this spec switches the report's own
// "Third column" selector (data-testid="third-column-mode", real values
// "total"/"balance" per source) to Balance before asserting, rather than
// reading whatever the default happens to be.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-41/R-42.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Same real, live project as R-41/R-42's specs (7 real progress entries,
// confirmed 2026-09-10).
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-43: Cum Amt, Current Amt and Balance Amt columns render real values in Balance mode, against a real project", async ({ page }) => {
  await page.goto(`/work-progress?tab=report&projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });

  const runButton = page.getByRole("button", { name: /run report/i });
  if (await runButton.isVisible().catch(() => false)) {
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  // Switch the real "Third column" selector to Balance -- the requirement
  // names Balance Amt specifically, not the "total" default.
  await page.locator('[data-testid="third-column-mode"]').click();
  await page.getByRole("option", { name: "Balance", exact: true }).click();
  await page.waitForLoadState("networkidle");

  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the report must show an Amount column band").toContain("Amount");
  expect(bodyText, "in Balance mode the third sub-header must read Balance, not Total").toMatch(/Amount[\s\S]{0,120}Balance/);

  // D58 falsifiability note (manual break-restore, not yet run -- see R-41's
  // spec header for the shared pipeline status): planting a defect means
  // temporarily hardcoding amt-prev/amt-current/amt-third to "" in
  // WorkProgressReportClient.tsx, confirming this goes red, then reverting.
  const amtPrev = page.locator('[data-testid="amt-prev"]').first();
  await expect(amtPrev, "at least one real Cum (Previous) Amt cell must be present").toBeVisible();
  const prevText = (await amtPrev.textContent()) ?? "";
  const currentText = (await page.locator('[data-testid="amt-current"]').first().textContent()) ?? "";
  const thirdText = (await page.locator('[data-testid="amt-third"]').first().textContent()) ?? "";
  expect(prevText + currentText + thirdText, "the first row's amount cells must not all be empty").not.toBe("");
});
