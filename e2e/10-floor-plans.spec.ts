import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /floor-plans (FloorPlansClient.tsx) is project-scoped, a card grid (not a
// table), no search/sort/pagination. Each card links to a 2D editor
// (/floor-plans/[id]) and a 3D walkthrough (/floor-plans/[id]/walkthrough)
// -- out of this file's scope per the task's module list, but this test
// confirms the links exist and point at the real created plan's id.
test.describe("floor-plans", () => {
  test("baseline matches the real (empty) seed data for the default project", async ({ page }) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/floor-plans?") && r.request().method() === "GET"),
      page.goto(`/floor-plans?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const api = (await res.json()) as { floorPlans: unknown[] };
    await expect(page.getByRole("heading", { level: 1, name: "Floor Plans" })).toBeVisible();

    if (api.floorPlans.length === 0) {
      await expect(page.getByText("No floor plans yet.")).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "2D Editor" })).toHaveCount(api.floorPlans.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `floor plans=${api.floorPlans.length} for ${DEFAULT_PROJECT.name} at test time. At authoring time this and every other project had 0 floor plans seeded -- a real seed-completeness gap for this in-scope module. A non-zero count here on a later run reflects this suite's own additive writes (no teardown), not new seed data.`,
    });
  });

  test("creating a floor plan persists and links to the real 2D editor route (real write)", async ({ page }) => {
    const [beforeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/floor-plans?") && r.request().method() === "GET"),
      page.goto(`/floor-plans?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const before = (await beforeRes.json()) as { floorPlans: unknown[] };
    const planName = `E2E Test Layout ${uniqueSuffix()}`;

    await expect(page.getByRole("heading", { level: 1, name: "Floor Plans" })).toBeVisible();

    await page.getByRole("button", { name: "New Floor Plan" }).click();
    await fieldInput(page, "Name").fill(planName);
    await fieldInput(page, "Floor Level (optional)").fill("Ground Floor");
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/floor-plans") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("Floor plan created")).toBeVisible();

    const card = page.locator(".shadow-card", { hasText: planName });
    await expect(card).toBeVisible();
    await expect(card.getByText("draft")).toBeVisible();

    const [afterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/floor-plans?") && r.request().method() === "GET"),
      page.reload(),
    ]);
    const after = (await afterRes.json()) as { floorPlans: { id: string; name: string; floorLevel: string | null }[] };
    expect(after.floorPlans.length).toBe(before.floorPlans.length + 1);
    const created = after.floorPlans.find((p) => p.name === planName);
    expect(created?.floorLevel).toBe("Ground Floor");

    const reloadedCard = page.locator(".shadow-card", { hasText: planName });
    await expect(reloadedCard.getByRole("link", { name: "2D Editor" })).toHaveAttribute("href", `/floor-plans/${created?.id}`);
    await expect(reloadedCard.getByRole("link", { name: "3D Walkthrough" })).toHaveAttribute(
      "href",
      `/floor-plans/${created?.id}/walkthrough`
    );
  });
});
