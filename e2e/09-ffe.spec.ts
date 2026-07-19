import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /ffe ("FF&E Specification", FfeClient.tsx) is project-scoped, no
// search/sort/pagination. 3 summary cards (Total Cost / Total Client Price
// / Margin) derive from /api/ffe/margin-summary, independent of the table.
test.describe("ffe", () => {
  test("baseline matches the real (empty) seed data for the default project", async ({ page }) => {
    const [itemsRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/ffe?") && r.request().method() === "GET"),
      page.goto(`/ffe?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const items = (await itemsRes.json()) as { items: unknown[] };
    await expect(page.getByRole("heading", { level: 1, name: "FF&E Specification" })).toBeVisible();

    if (items.items.length === 0) {
      await expect(page.getByText("No FF&E items yet.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(items.items.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `ffe items=${items.items.length} for ${DEFAULT_PROJECT.name} at test time. At authoring time this and every other project had 0 FF&E items seeded -- a real seed-completeness gap for this in-scope module. A non-zero count here on a later run reflects this suite's own additive writes (no teardown), not new seed data.`,
    });
  });

  test("creating an FF&E item persists, and advancing its status persists too (real write chain)", async ({ page }) => {
    const [beforeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/ffe?") && r.request().method() === "GET"),
      page.goto(`/ffe?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const before = (await beforeRes.json()) as { items: unknown[] };
    const itemName = `E2E Test Sofa ${uniqueSuffix()}`;

    await expect(page.getByRole("heading", { level: 1, name: "FF&E Specification" })).toBeVisible();

    await page.getByRole("button", { name: "New Item" }).click();
    await fieldInput(page, "Item Name").fill(itemName);
    await fieldInput(page, "Room / Area").fill("Living Room");
    await fieldInput(page, "Category").click();
    await page.getByRole("option", { name: "furniture", exact: true }).click();
    await fieldInput(page, "Qty").fill("2");
    await fieldInput(page, /^Cost/).fill("15000");
    await fieldInput(page, /^Client Price/).fill("22000");
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/ffe") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Item" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("FF&E item added")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(itemName) });
    await expect(row).toBeVisible();
    await expect(row.getByText("specified")).toBeVisible();

    const [advanceRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/ffe\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"),
      row.getByRole("button", { name: "Advance" }).click(),
    ]);
    expect(advanceRes.status()).toBe(200);
    await expect(row.getByText("ordered")).toBeVisible();

    const [afterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/ffe?") && r.request().method() === "GET"),
      page.reload(),
    ]);
    const after = (await afterRes.json()) as { items: { itemName: string; status: string; quantity: number }[] };
    expect(after.items.length).toBe(before.items.length + 1);
    const created = after.items.find((i) => i.itemName === itemName);
    expect(created?.status).toBe("ordered");
    expect(created?.quantity).toBe(2);
  });
});
