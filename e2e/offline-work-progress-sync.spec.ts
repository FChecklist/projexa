import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldByLabel } from "./helpers";

// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION
// SUCCESS_CRITERIA: "entering progress data with the network disabled
// queues it locally; re-enabling network triggers a real sync that lands
// the data server-side."
//
// NOT YET RUN against the live site at authoring time: projexa-ai.com/login
// currently serves compliance-tracker's own login UI instead of PROJEXA's
// (a pre-existing prod deployment issue, first documented in the
// immediately-prior PR's PROGRESS.md/ai-os/PIVOT_CHART_TECH_DECISION doc,
// re-confirmed live during this task via a direct curl of /login). That
// blocks auth.setup.ts's real login flow for every spec in this suite, not
// just this one. This file is the real, durable artifact -- it will run
// correctly once that routing issue is fixed and this PR's offline-queue
// code is deployed. In the meantime, the real work-progress-queue.ts
// module (enqueue/sync/retry logic) is unit-tested directly against a real
// IndexedDB in src/lib/offline/work-progress-queue.test.ts -- see that
// file's header for why that's a genuine substitute, not a weaker stand-in.
test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

test.describe("offline work-progress capture + sync", () => {
  test("logging progress while offline queues it locally; reconnecting syncs it server-side", async ({ page, context }) => {
    await page.goto(`/work-progress?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Work Progress" })).toBeVisible();

    const beforeCount = await page.locator("table tbody tr").count();

    await context.setOffline(true);

    await page.getByRole("button", { name: /log progress/i }).click();
    const dialog = page.getByRole("dialog");
    // Activity picker only renders once /api/work-progress/activities has
    // resolved -- that GET was already warmed by the page's initial load,
    // so the Select is populated even offline (it isn't refetched here).
    await dialog.getByText("Activity", { exact: true }).waitFor();

    await fieldByLabel(dialog, "Quantity Done").fill("7");
    await fieldByLabel(dialog, "% Complete").fill("55");

    await dialog.getByTestId("work-progress-submit").click();

    // Real, visible "queued, will sync" state -- not a silent failure.
    await expect(page.getByTestId("work-progress-queue")).toBeVisible();
    await expect(page.getByTestId("work-progress-queue")).toContainText("1 entry queued, will sync");
    await expect(page.getByTestId("work-progress-queue-item")).toContainText("7 qty, 55%");

    // The real entries table is unchanged -- nothing landed server-side yet.
    expect(await page.locator("table tbody tr").count()).toBe(beforeCount);

    await context.setOffline(false);
    // The queue's own `online` event listener drains it -- no manual
    // action from the user required.
    await expect(page.getByTestId("work-progress-queue")).toBeHidden({ timeout: 20_000 });

    await page.reload();
    expect(await page.locator("table tbody tr").count()).toBe(beforeCount + 1);
    await expect(page.locator("table tbody tr").filter({ hasText: "55%" })).toHaveCount(1);
  });
});
