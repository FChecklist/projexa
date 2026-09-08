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

    // Real screen navigation (FfeClient.tsx:90-92, "replaces the old 'New
    // Item' Dialog popup with a real create route") -- New Item pushes to
    // /ffe/new (FfeCreateClient.tsx), it does not open a dialog. Field
    // selectors below are unchanged: the create page kept "same fields"
    // (FfeCreateClient.tsx:3-4) as the old dialog.
    await page.getByRole("button", { name: "New Item" }).click();
    await expect(page).toHaveURL(/\/ffe\/new(\?|$)/);
    await fieldInput(page, "Item Name").fill(itemName);
    await fieldInput(page, "Room / Area").fill("Living Room");
    await fieldInput(page, "Category").click();
    await page.getByRole("option", { name: "furniture", exact: true }).click();
    await fieldInput(page, "Qty").fill("2");
    await fieldInput(page, /^Cost/).fill("15000");
    await fieldInput(page, /^Client Price/).fill("22000");
    // veridian-ui-kit's ObjectScreen renders one footer button for every
    // isEditing mode (edit AND create) and it is always literally "Save"
    // (ObjectScreen.tsx:90-100, shared by FfeCreateClient.tsx's create
    // mode) -- there is no "Add Item" control anywhere in this flow.
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/ffe") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("FF&E item added")).toBeVisible();

    // FfeCreateClient.tsx:48 -- on success the app navigates to the new
    // item's own Object Page (/ffe/[id]); it does NOT stay on the /ffe list,
    // so there is no table row to inspect here. The status lives in
    // FfeObjectClient.tsx's "Status" definition-list field (dt/dd pair,
    // line 150), scoped the same way helpers.ts's fieldInput() scopes
    // labelled controls -- StatusBadge (the header badge) shows the same
    // text too, so an unscoped getByText("specified") is a strict-mode
    // multi-match.
    await expect(page).toHaveURL(/\/ffe\/[^/?]+$/);
    await expect(page.getByRole("heading", { level: 1, name: itemName })).toBeVisible();
    const statusField = page.locator("dt", { hasText: "Status" }).locator("xpath=following-sibling::dd[1]");
    await expect(statusField).toHaveText("specified");

    // FfeObjectClient.tsx:141-143 -- the real advance control's accessible
    // name interpolates the destination status ("Advance to ordered"), not
    // the bare "Advance" the pre-conversion /ffe list row used.
    const [advanceRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/ffe\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Advance to ordered" }).click(),
    ]);
    expect(advanceRes.status()).toBe(200);
    await expect(statusField).toHaveText("ordered");

    // Back to the list (FfeObjectClient.tsx:133, onBack) to confirm the
    // write actually persisted into the project's real FF&E schedule --
    // /api/ffe response shape is unchanged ({ items: [...] }, route.ts:14).
    const [afterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/ffe?") && r.request().method() === "GET"),
      page.getByRole("button", { name: /Back/ }).click(),
    ]);
    const after = (await afterRes.json()) as { items: { itemName: string; status: string; quantity: number }[] };
    expect(after.items.length).toBe(before.items.length + 1);
    const created = after.items.find((i) => i.itemName === itemName);
    expect(created?.status).toBe("ordered");
    expect(created?.quantity).toBe(2);
  });
});
