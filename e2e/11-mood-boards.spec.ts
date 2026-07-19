import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /mood-boards (MoodBoardsClient.tsx) is project-scoped, a card grid with a
// NESTED shape (boards -> items), no search/sort/pagination. One shared
// "Add Item" dialog is reused across all board cards (keyed by `addingTo`
// state) -- this file opens it from a specific card, not a static trigger.
test.describe("mood-boards", () => {
  test("baseline matches the real (empty) seed data for the default project", async ({ page }) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/mood-boards?") && r.request().method() === "GET"),
      page.goto(`/mood-boards?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const api = (await res.json()) as { boards: { items: unknown[] }[] };
    await expect(page.getByRole("heading", { level: 1, name: "Mood Boards" })).toBeVisible();

    if (api.boards.length === 0) {
      await expect(page.getByText("No mood boards yet.")).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Add Item" })).toHaveCount(api.boards.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `mood boards=${api.boards.length} for ${DEFAULT_PROJECT.name} at test time. At authoring time this and every other project had 0 mood boards seeded -- a real seed-completeness gap for this in-scope module. A non-zero count here on a later run reflects this suite's own additive writes (no teardown), not new seed data.`,
    });
  });

  test("creating a mood board, adding an item to it, and sharing it with the client all persist (real write chain)", async ({
    page,
  }) => {
    const [beforeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/mood-boards?") && r.request().method() === "GET"),
      page.goto(`/mood-boards?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const before = (await beforeRes.json()) as { boards: unknown[] };
    const suffix = uniqueSuffix();
    const boardTitle = `E2E Test Board ${suffix}`;
    const itemLabel = `E2E Accent Item ${suffix}`;

    await expect(page.getByRole("heading", { level: 1, name: "Mood Boards" })).toBeVisible();

    await page.getByRole("button", { name: "New Mood Board" }).click();
    await fieldInput(page, "Title").fill(boardTitle);
    await fieldInput(page, "Room / Area (optional)").fill("Living Room");
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/mood-boards") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("Mood board created")).toBeVisible();

    const card = page.locator(".shadow-card", { hasText: boardTitle });
    await expect(card).toBeVisible();
    await expect(card.getByText("draft")).toBeVisible();
    await expect(card.getByText("No items yet.")).toBeVisible();

    // Add an item to THIS specific board (the dialog is shared across
    // cards, keyed by which "Add Item" button was clicked).
    await card.getByRole("button", { name: "Add Item" }).click();
    await expect(page.getByRole("dialog", { name: `Add Item: ${boardTitle}` })).toBeVisible();
    await fieldInput(page, "Label").fill(itemLabel);
    await fieldInput(page, "Notes (optional)").fill("E2E test note");
    const [itemRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/mood-boards\/[^/]+$/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
    expect(itemRes.status()).toBe(201);
    await expect(card.getByText(itemLabel)).toBeVisible();

    // Status transition: draft -> shared.
    const [shareRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/mood-boards\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"),
      card.getByRole("button", { name: "Share with Client" }).click(),
    ]);
    expect(shareRes.status()).toBe(200);
    await expect(card.getByText("shared")).toBeVisible();
    await expect(card.getByRole("button", { name: "Mark Approved" })).toBeVisible();

    const [afterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/mood-boards?") && r.request().method() === "GET"),
      page.reload(),
    ]);
    const after = (await afterRes.json()) as { boards: { title: string; status: string; items: { label: string | null }[] }[] };
    expect(after.boards.length).toBe(before.boards.length + 1);
    const created = after.boards.find((b) => b.title === boardTitle);
    expect(created?.status).toBe("shared");
    expect(created?.items.some((i) => i.label === itemLabel)).toBeTruthy();
  });
});
