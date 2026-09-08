import { test, expect } from "@playwright/test";

// R81 D0-06: re-measure R80 Part 4's three-way vertical split.
//
// Part 4 reported "245/245/245 at 1280x800" for the UNDOCKED case (Task
// Master collapsed). That figure was recorded in CHANGELOG.md only -- there
// was no test holding the invariant, so nothing would catch a regression.
// This spec IS that missing test.
//
// The three sections are Composer.tsx's `h-1/3 shrink-0 grow-0` boxes:
// frequent-actions (top), conversation+mode-pills (middle), chat box (bottom).
// Undocked they are driven by `dockedOverTaskMaster={tasksExpanded}` from
// M24Shell.tsx:3423, so "collapsed Task Master" is the state under test.
test.use({ storageState: "playwright/.auth/ceo.json", viewport: { width: 1280, height: 800 } });

test("R81 D0-06: the undocked composer left panel is three equal vertical thirds", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const thirds = page.locator('[class*="h-1/3"]');
  await expect(thirds.first()).toBeVisible({ timeout: 20_000 });
  const n = await thirds.count();

  const heights: number[] = [];
  for (let i = 0; i < n; i++) {
    const box = await thirds.nth(i).boundingBox();
    heights.push(box ? Math.round(box.height) : -1);
  }
  console.log(`R81_D06_MEASURED sections=${n} heights=${JSON.stringify(heights)}`);

  expect(n, "three h-1/3 sections must be present when undocked").toBe(3);
  // equal to within 1px of each other (rounding), and each a real third
  const [a, b, c] = heights;
  expect(Math.abs(a - b), `top ${a} vs middle ${b}`).toBeLessThanOrEqual(1);
  expect(Math.abs(b - c), `middle ${b} vs bottom ${c}`).toBeLessThanOrEqual(1);
});
