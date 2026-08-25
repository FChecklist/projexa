import { test, expect } from "@playwright/test";

// R48 / fault R48_TICK_ON_ERROR_01.
//
// The Assistant Overview timeline used to choose its badge glyph from
// item.type, never from item.status, so a FAILED or still-RUNNING query
// rendered exactly the same success tick as a completed one. Observed live
// on https://projexa-ai.com/settings at 8a5eb59: six rows showed a tick
// while their own status sub-label read "Error".
//
// This is deliberately a PROPERTY test, not a fixture test: it asserts that
// the badge never contradicts the row's own status, whatever queries happen
// to exist at run time. That is the assertion that would have caught the
// original defect, and it keeps holding as the data changes.
test.use({ storageState: "playwright/.auth/ceo.json" });

const EXPECTED_LABEL: Record<string, string> = {
  pending: "Working",
  done: "Done",
  error: "Failed",
};

test("Assistant Overview badge never contradicts the row's own status", async ({ page }) => {
  await page.goto("/dashboard");

  const rows = page.locator('[data-testid="overview-item"][data-status]');
  await expect
    .poll(async () => rows.count(), {
      message: "Assistant Overview never rendered a query row to check",
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const status = await row.getAttribute("data-status");
    if (!status) continue;

    const expected = EXPECTED_LABEL[status];
    expect(expected, `unknown status "${status}" rendered by the panel`).toBeTruthy();

    // The badge states the row's own outcome, in its accessible name.
    await expect(
      row.locator(`[aria-label="${expected}"]`),
      `row ${i} has data-status="${status}" so its badge must read "${expected}"`,
    ).toHaveCount(1);

    // And it must never claim success for a row that did not succeed.
    if (status !== "done") {
      await expect(
        row.locator('[aria-label="Done"]'),
        `row ${i} is "${status}" but renders the success badge`,
      ).toHaveCount(0);
    }
  }
});
