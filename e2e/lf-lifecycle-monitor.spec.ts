import { test, expect } from "@playwright/test";
import { makePerson, newWorld, signIn, stubSyncService } from "./support/lf-lifecycle-stub";

// LOCAL-FIRST prepare monitor (owner directive 2026-10-03): "if the download is happening and, for any reason, it stops, we should know at our
// end ... without the files PROJEXA does not work ... we cannot lose a customer". In a real Chromium (playwright.local-first.config.ts):
//   * the screen shows ONLY the title, the sentence and the percentage: no step list, no error text, no Skip, no button;
//   * while the sync service cannot be reached the laptop is NOT let in, and it tells us (POST /prepare) where it stopped and WHY;
//   * it keeps telling us (heartbeat / retry) while it is stuck, and tries again by itself;
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

  await test.step("we are told it stopped, where, and why", async () => {
    await expect
      .poll(() => world.prepares.filter((p) => p.status === "failed" || p.status === "retrying").length, { timeout: 150_000, message: "the laptop never told us its preparation was failing" })
      .toBeGreaterThan(0);
    const failure = world.prepares.find((p) => p.status === "failed" || p.status === "retrying")!;
    expect(failure).toMatchObject({ stage: "projects", error_class: "service_unreachable", device_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    expect(Number(failure.percent)).toBeLessThan(100);
    // still locked in: the person is not let into a laptop that has no copy
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("button")).toHaveCount(0);
  });

  await test.step("while it is stuck it keeps telling us (heartbeat / retry), and tries again by itself", async () => {
    const before = world.prepares.length;
    await expect.poll(() => world.prepares.length, { timeout: 120_000, message: "a stuck laptop went silent" }).toBeGreaterThan(before);
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
