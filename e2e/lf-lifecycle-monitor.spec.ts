import { test, expect } from "@playwright/test";
import { makePerson, newWorld, signIn, stubSyncService } from "./support/lf-lifecycle-stub";

// LOCAL-FIRST prepare monitor (owner directive 2026-10-03): "if the download is happening and, for any reason, it stops, we should know at our
// end ... without the files PROJEXA does not work ... we cannot lose a customer". In a real Chromium (playwright.local-first.config.ts):
//   * the screen shows ONLY the title, the sentence and the percentage: no step list, no error text, no Skip, no button;
//   * while the sync service cannot be reached the laptop is NOT let in; it heartbeats the same stage and percentage (the server calls that STUCK),
//     then tells us (POST /prepare) it FAILED, where, and why when its time budget ends, and tries again by itself;
//   * once the service answers it reaches 100%, PROJEXA opens by itself, and the last thing we hear is `done` at 100.

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

  await test.step("we are told where it stopped and WHY, again and again while it is stuck, and the person is not let in", async () => {
    await expect
      .poll(() => world.prepares.filter((p) => p.stage === "projects").length, { timeout: 150_000, message: "the laptop never told us it was stuck in the projects stage" })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(() => world.prepares.some((p) => p.status === "failed" || p.status === "retrying"), { timeout: 150_000, message: "the laptop never told us its preparation failed" })
      .toBe(true);
    const failure = world.prepares.find((p) => p.status === "failed" || p.status === "retrying")!;
    expect(failure).toMatchObject({ stage: "projects", device_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    expect(["service_unreachable", "timeout"], `failure report: ${JSON.stringify(failure)}`).toContain(failure.error_class);
    const stuck = world.prepares.filter((p) => p.stage === "projects");
    expect(new Set(stuck.map((p) => p.percent)).size, "no progress while the service is down").toBe(1);
    expect(Number(stuck[0]!.percent)).toBeLessThan(100);
    await expect(dialog, "a laptop without its copy is not let in").toBeVisible();
    await expect(dialog.locator("button")).toHaveCount(0);
  });

  await test.step("it tries again by itself", async () => {
    const manifestHits = world.hits.filter((h) => h.route === "manifest").length;
    await expect.poll(() => world.hits.filter((h) => h.route === "manifest").length, { timeout: 120_000, message: "it did not try again by itself" }).toBeGreaterThan(manifestHits);
  });

  await test.step("the service comes back: it reaches 100%, PROJEXA opens by itself, and our last word from it is done at 100", async () => {
    world.failRoutes.names.clear();
    await expect(dialog, "the screen never finished and opened PROJEXA after the service came back").toHaveCount(0, { timeout: 180_000 });
    await expect.poll(() => world.prepares.at(-1)?.status, { timeout: 60_000, message: "we were never told it finished" }).toBe("done");
    expect(world.prepares.at(-1)).toMatchObject({ stage: "done", percent: 100, error_class: null });
    // the percentage never claimed 100 before it was true
    const early = world.prepares.slice(0, -1).filter((p) => p.status !== "done");
    expect(early.every((p) => Number(p.percent) < 100)).toBe(true);
  });
});
