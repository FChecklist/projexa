import { test, expect } from "@playwright/test";

test.use({ storageState: "playwright/.auth/ceo.json" });

// R67 G-04 (R-231) acceptance, verbatim: "open /schedule/tasks/new and assert
// that no select element displays the text 'Loading...' after the page
// settles, and that the Type control is disabled while its options are still
// loading."
//
// HOW TO RUN IT. This suite's baseURL defaults to the live site
// (playwright.config.ts), which will only carry this behaviour once the
// change is deployed. Against a local server:
//
//   bunx next dev -p 3100
//   PLAYWRIGHT_BASE_URL=http://localhost:3100 bunx playwright test \
//     e2e/schedule-task-type-signage.spec.ts
//
// NOT RUN AS PART OF THIS CHANGE: WS-G's working agreement forbids starting a
// dev server, and this repo's Playwright suite does not run in CI. The rule
// this spec checks is also asserted, headlessly and deterministically, in
// src/lib/schedule-type-state.test.ts -- which DOES run in CI -- so the
// behaviour is covered either way; this file is the browser-level proof the
// acceptance criterion asks for, ready to run wherever a server exists.

const TYPE_CONTROL = "[data-testid='schedule-task-type']";
const TYPE_LOADING = "[data-testid='schedule-task-type-loading']";

test.describe("New Task: the Type control never shows a loading word as its value", () => {
  test("the Type control is disabled while its options are still loading", async ({ page }) => {
    // Hold /api/schedule/types open so the loading state is observable rather
    // than a race -- the real one lasts a few hundred milliseconds.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/schedule/types", async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/schedule/tasks/new");

    // While the options are in flight, the control is a disabled skeleton in
    // the select's own shape: not openable, and carrying no word at all.
    const loading = page.locator(TYPE_LOADING);
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("aria-disabled", "true");
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(loading).not.toContainText("Loading");
    await expect(page.locator(TYPE_CONTROL)).toHaveCount(0);

    release();
    await expect(page.locator(TYPE_CONTROL)).toBeVisible();
  });

  test("no select element displays the text 'Loading...' after the page settles", async ({ page }) => {
    await page.goto("/schedule/tasks/new");
    await expect(page.getByRole("heading", { name: "New Task" })).toBeVisible();
    await expect(page.locator(TYPE_LOADING)).toHaveCount(0);

    // Every combobox on the settled page -- Type and Priority -- and no
    // loading word in any of them, in either spelling.
    const comboboxes = page.getByRole("combobox");
    const count = await comboboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = (await comboboxes.nth(i).innerText()).toLowerCase();
      expect(text).not.toContain("loading");
    }
  });

  test("an empty task-type list says so, and says what Save will do", async ({ page }) => {
    await page.route("**/api/schedule/types", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ types: [] }) })
    );

    await page.goto("/schedule/tasks/new");
    await expect(page.locator(TYPE_CONTROL)).toContainText("No task types - Add one");
    await expect(page.locator(TYPE_CONTROL)).toBeDisabled();
    await expect(page.getByText("Task types come from VERIDIAN.", { exact: false })).toBeVisible();
  });

  test("a failed load is not reported as 'this org has no task types'", async ({ page }) => {
    await page.route("**/api/schedule/types", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "upstream" }) })
    );

    await page.goto("/schedule/tasks/new");
    await expect(page.locator(TYPE_CONTROL)).toContainText("Task types didn't load");
    await expect(page.locator(TYPE_CONTROL)).not.toContainText("No task types");
  });
});
