import { test, expect } from "@playwright/test";
import { buildProjectFixture } from "./support/boq-fixture";
import { signInLocally, stubAppApis, stubGateway } from "./support/boq-local";

// PROJEXA-BUILD-001 U-33, register row BR-421 (E-10, D-11): filtering a 10,907-line fixture runs in a Web Worker, and the longest
// main-thread long task during the filter is under 50 ms. Runs ONLY through playwright.boq-local.config.ts (see that file): a local
// PROJEXA server, a synthetic signed-in browser, the gateway and the page's /api calls answered from synthetic data. No real session,
// nothing reaches Vercel.
//
// One test on purpose: the register row expects the runner to print "1 passed".
//
// HOW THE LONG TASK IS MEASURED. A PerformanceObserver of type "longtask" (Chromium) reports every main-thread task that runs 50 ms or
// more. It is installed after the page has loaded and settled, so the load itself is not counted, and it is first proved able to see a
// task: a 120 ms busy loop is run on purpose and must be reported before the real filter starts. Then "formwork" is typed with real
// keystrokes (eight filter runs over all 10,907 lines) and the largest reported duration must be under 50 ms.
type Measured = { __boqLongTasks?: number[]; __boqObserver?: PerformanceObserver };

test("filtering a 10,907-line project runs in a Web Worker and no main-thread task reaches 50 ms", async ({ page, context }) => {
  const fixture = buildProjectFixture();
  const session = await signInLocally(context);
  await stubGateway(page, fixture, session.accessToken);
  await stubAppApis(page, fixture);

  await page.goto(`/scope/${fixture.boqId}`);
  const panel = page.getByTestId("boq-line-explorer");
  await expect(panel).toBeVisible({ timeout: 120_000 });
  await expect(panel).toHaveAttribute("data-indexed-lines", String(fixture.expected.total));

  await test.step("the search runs in a worker, not on the main thread", async () => {
    await expect(panel).toHaveAttribute("data-filter-engine", "worker");
    expect(page.workers().length).toBeGreaterThanOrEqual(1);
  });

  await test.step("the scope is the whole project, so the filter has 10,907 lines to go through", async () => {
    await panel.getByRole("button", { name: "All BOQs in project" }).click();
    await expect(page.getByTestId("boq-explorer-count")).toContainText(`(${fixture.expected.total} in the project)`);
  });

  await test.step("the long-task observer can see a task: a 120 ms busy loop is reported", async () => {
    await page.evaluate(() => {
      const w = window as unknown as Measured;
      w.__boqLongTasks = [];
      w.__boqObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__boqLongTasks!.push(entry.duration);
      });
      w.__boqObserver.observe({ type: "longtask" });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const start = performance.now();
            while (performance.now() - start < 120) {
              // hold the main thread on purpose
            }
            resolve();
          }, 0);
        })
    );
    await expect
      .poll(() => page.evaluate(() => ((window as unknown as Measured).__boqLongTasks ?? []).filter((d) => d >= 100).length), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as unknown as Measured).__boqLongTasks = [];
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as unknown as Measured).__boqLongTasks = [];
    });
  });

  await test.step("typing 'formwork' filters the project and the longest main-thread task stays under 50 ms", async () => {
    await panel.getByLabel("Filter BOQ lines").pressSequentially("formwork", { delay: 40 });
    await expect(page.getByTestId("boq-explorer-count")).toContainText(`of ${fixture.expected.formworkInProject} matching lines (${fixture.expected.total} in the project)`);
    await expect(page.getByTestId("boq-explorer-row")).toHaveCount(Math.min(100, fixture.expected.formworkInProject));
    await page.waitForTimeout(500); // a long task is reported after it ends, so give the observer time to deliver
    const durations = await page.evaluate(() => (window as unknown as Measured).__boqLongTasks ?? []);
    expect(Math.max(0, ...durations)).toBeLessThan(50);
    await expect(panel).toHaveAttribute("data-filter-engine", "worker");
  });
});
