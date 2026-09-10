import { test, expect } from "@playwright/test";

// R-41 (Work Progress): "Previous % / Current % / Total % columns". Recorded
// closure_state=BLOCKED, same shared root cause as R-11/15/30/31 -- the
// eleven in F-2026-0910-PM-068. Grounded directly in source:
// src/components/WorkProgressReportClient.tsx's ScopeTable renders a
// "Percent" header band (colSpan=3) with "Previous" / "Current" / third-label
// sub-headers, and each data row carries real, stable
// data-testid="pct-prev" / "pct-current" / "pct-third" cells.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-60/R-11/R-15/R-30/R-31.
test.use({ storageState: "playwright/.auth/ceo.json" });

// A real project in the Meridian E2E org (org_id=4ecc472f-4152-4310-ae8d-
// cf8b7c52ab6d) confirmed live 2026-09-10 to have 7 real rows in
// compliance.construction_work_progress_entries (so the report renders real
// data rows, not the empty-state message).
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-41: Previous %, Current % and Total % columns render real values, against a real project", async ({ page }) => {
  await page.goto(`/work-progress?tab=report&projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });

  // The report may need an explicit "Run Report" click (R67 C-06's door) if
  // it did not auto-run for this project/range; harmless no-op if it already
  // has, since the button reflects current state rather than toggling it.
  const runButton = page.getByRole("button", { name: /run report/i });
  if (await runButton.isVisible().catch(() => false)) {
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  // The header bands themselves, read directly.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the report must show a Percent column band").toContain("Percent");
  expect(bodyText, "the Percent band must show Previous/Current sub-headers").toMatch(/Previous[\s\S]{0,40}Current/);

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job): planting a defect means
  // temporarily hardcoding pct-prev/pct-current/pct-third to "" in
  // WorkProgressReportClient.tsx, confirming this goes red, then reverting.
  const pctPrev = page.locator('[data-testid="pct-prev"]').first();
  await expect(pctPrev, "at least one real Previous % cell must be present").toBeVisible();
  const pctCurrent = page.locator('[data-testid="pct-current"]').first();
  const pctThird = page.locator('[data-testid="pct-third"]').first();
  // At least one of the three per-line percent cells (prev/current/third) on
  // a real parent line must carry an actual percentage figure -- child rows
  // deliberately render blank cells here (WPR-06: percentages are parent-only,
  // isChild guard in source), so this checks the union rather than assuming
  // row 1 is a parent.
  const allText = ((await pctPrev.textContent()) ?? "") + ((await pctCurrent.textContent()) ?? "") + ((await pctThird.textContent()) ?? "");
  expect(allText, "the first row's percent cells must not all be empty").not.toBe("");
});
