import { test, expect } from "@playwright/test";
import { makePerson, newWorld, signIn, stubSyncService } from "./support/lf-lifecycle-stub";

// LOCAL-FIRST prepare monitor (owner directive 2026-10-03): "if the download is happening and, for any reason, it stops, we should know at our
// end ... without the files PROJEXA does not work ... we cannot lose a customer". In a real Chromium (playwright.local-first.config.ts):
//   * the screen shows ONLY the title, the sentence and the percentage: no step list, no error text, no Skip, no button;
//   * the full screen is the ONE-TIME INSTALL (worker, screens, local database). Once that is done the person is let in and it is remembered
//     for good (owner, 2026-10-05: "the projects copy happens in the background; the user must not wait on every login or refresh");
//   * while the sync service cannot be reached the projects copy is reported to us (POST /prepare: stage, why) and retried quietly by
//     itself, with NOTHING on the person's screen;
//   * a refresh never brings the screen back.

const A = makePerson("mona", "lf-org-1", "Monitor Point Tower", "Monitor Point - Structure");

test("a preparation that cannot finish is seen on our side with its reason, retries by itself, and opens PROJEXA only at 100%", async ({ page, context }) => {
  const world = newWorld();
  await stubSyncService(context, world);
  world.failRoutes = { names: new Set(["manifest"]), status: 503 }; // the copy service is down

  await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);

  const dialog = page.getByTestId("workspace-prepare");
  await test.step("the screen is only the title, the sentence and the percentage", async () => {
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("Preparing your PROJEXA workspace");
    await expect(dialog).toContainText("PROJEXA workspace is being set up on this laptop so your projects open fast.");
    await expect(page.getByTestId("prepare-percent")).toHaveText(/^\d+%$/);
    await expect(dialog.locator("button, li, a"), "no steps, no buttons, nothing to skip or press").toHaveCount(0);
    await expect(page.getByText(/Skip for now|Open PROJEXA|not reachable|still works/)).toHaveCount(0);
  });

  await test.step("the install is done, so the person is let in even though the projects could not be copied", async () => {
    await expect(dialog, "the full screen must close once the install is done").toHaveCount(0, { timeout: 150_000 });
  });

  await test.step("we are still told where the projects copy stopped and WHY", async () => {
    await expect
      .poll(() => world.prepares.some((p) => p.stage === "projects" && (p.status === "failed" || p.status === "retrying")), { timeout: 150_000, message: "the laptop never told us the projects copy failed" })
      .toBe(true);
    const failure = world.prepares.find((p) => p.status === "failed" || p.status === "retrying")!;
    expect(["service_unreachable", "timeout"], `failure report: ${JSON.stringify(failure)}`).toContain(failure.error_class);
  });

  await test.step("it tries again by itself, quietly", async () => {
    const manifestHits = world.hits.filter((h) => h.route === "manifest").length;
    await expect.poll(() => world.hits.filter((h) => h.route === "manifest").length, { timeout: 120_000, message: "it did not try again by itself" }).toBeGreaterThan(manifestHits);
    await expect(dialog).toHaveCount(0);
  });

  await test.step("a refresh does not bring the screen back", async () => {
    world.failRoutes.names.clear();
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  });
});
