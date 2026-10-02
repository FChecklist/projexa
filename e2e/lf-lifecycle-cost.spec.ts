import { test, expect } from "@playwright/test";
import { countByRoute, makePerson, newWorld, personMeta, prepareLaptop, stubSyncService, watchConsole } from "./support/lf-lifecycle-stub";

// LOCAL-FIRST lifecycle (package lf-e12), R14 "cost near zero": the REAL number of requests one working day of a laptop sends to our server,
// counted in a real Chromium (playwright.local-first.config.ts), next to the unit simulation's number (src/lib/local-first/cost/*,
// docs/local-first/COST_MODEL.md: ~209 for a working day of 30 edits and 30 colleague changes, budget 260).
//
// The day: the laptop is already prepared (the first copy is the cold-start scenario, counted apart); then, with the browser's clock faked
// (page.clock) so eight hours pass in seconds: the app opens, three screens are opened, 20 edits are made and saved, and the day runs to
// its end with every timer of the page firing as it would. The stub counts every request to the sync service (Supabase Edge, the quota
// that matters) by route; /api calls (Vercel) are counted apart. The printed table is the measurement; the assertions are the budget.

const P = makePerson("cost", "lf-org-1", "Cedar Heights Villa", "Cedar Heights - Structure");
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
/** src/lib/local-first/cost/budget.ts SCENARIO_BUDGETS.workday (the spec must not import app code; the number is copied and named). */
const WORKDAY_BUDGET = 260;

test("R14: one working day in the browser (open, 3 screens, 20 edits, 8 hours of timers) stays inside the request budget", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  await stubSyncService(context, world);
  const { session, app } = await prepareLaptop(page, context, world, P);
  const coldStart = countByRoute(world.hits);
  const coldStartTotal = world.hits.length;
  const apiBefore = app.requests.length;
  world.hits.length = 0;
  world.preflights = 0;

  const start = Date.now();
  await page.clock.install({ time: start });

  await test.step("the day starts: the app opens, three screens", async () => {
    await page.goto(`/local/scope?projectId=${P.projectId}`);
    await expect(page.getByTestId("scope-list-row").filter({ hasText: P.boqTitle })).toHaveCount(1);
    await page.clock.runFor(5_000);
    await page.goto(`/local/scope/${P.boqId}?projectId=${P.projectId}`);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await page.goto(`/local/dashboard?projectId=${P.projectId}`);
    await page.clock.runFor(5_000);
    await page.goto(`/local/scope/${P.boqId}?projectId=${P.projectId}`);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
  });

  await test.step("20 edits, spread over the morning", async () => {
    for (let i = 0; i < 20; i += 1) {
      const input = page.getByTestId("boq-line-category-input").nth(i % 3);
      await input.fill(`Cat ${i}`);
      await page.getByTestId("boq-line-save").click();
      await page.clock.runFor(10 * 60 * 1000); // ten minutes between edits
    }
    await expect.poll(() => personMeta(page, session.userId, "shell:edits"), { timeout: 60_000, message: "the edits were not all sent" }).toEqual([]);
  });

  await test.step("the rest of the day runs out (every timer of the page fires as it would)", async () => {
    const elapsed = Date.now() - start; // the fake clock moved; this is wall time only for the record
    void elapsed;
    await page.clock.runFor(EIGHT_HOURS - 20 * 10 * 60 * 1000);
  });

  const day = countByRoute(world.hits);
  const dayTotal = world.hits.length;
  const apiDay = app.requests.slice(apiBefore);
  const table = [
    `cold start (1 project x 1 kind, prepare): ${coldStartTotal} sync requests ${JSON.stringify(coldStart)}`,
    `working day (open, 3 screens, 20 edits, 8 h): ${dayTotal} sync requests ${JSON.stringify(day)}, ${world.preflights} CORS preflights`,
    `  /api (Vercel) during the day: ${apiDay.length} (${apiDay.filter((r) => r.startsWith("PATCH")).length} PATCH)`,
    `  unit simulation (cost-budget.test.ts workday): ~209, budget ${WORKDAY_BUDGET}`,
  ];
  console.log(`\nlf-e12 MEASURED COST\n${table.join("\n")}\n`);
  await test.info().attach("measured-cost", { body: table.join("\n"), contentType: "text/plain" });

  expect(dayTotal, "the day's sync requests are over the workday budget").toBeLessThanOrEqual(WORKDAY_BUDGET);
  // nothing changed on the server all day: nothing may have pulled a page again
  expect((day.pull ?? 0) + (day.pull_ids ?? 0), "a quiet day pulled rows again").toBe(0);
  // FINDING guard: every edit was sent (cost is never saved by not syncing). The BOQ screen's edits go to /api (PATCH), not to the sync service.
  expect(apiDay.filter((r) => r.startsWith("PATCH")).length).toBe(20);
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
  expect(console_.aiTamper()).toBe(0);
});
