import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /mood-boards (MoodBoardsClient.tsx) is project-scoped, a card grid with a
// NESTED shape (boards -> items), no search/sort/pagination.
//
// STALE AS OF the "Real-screen conversion (2026-08-30)" noted at
// MoodBoardsClient.tsx:3-8: the shared "Add Item" dialog (keyed by an
// `addingTo` state) and the old "New Mood Board" dialog are both gone.
// "New Mood Board" now navigates to a real create route (/mood-boards/new,
// MoodBoardCreateClient.tsx) and each card now just navigates to a real
// Object Page (/mood-boards/[id], MoodBoardObjectClient.tsx) where
// Edit/Add Item/Remove Item/status live -- see the inline comments below at
// each assertion this broke.
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
      // Stale: cards no longer carry a per-card "Add Item" button -- that
      // control moved to the Object Page (MoodBoardObjectClient.tsx:196-199).
      // The list page renders each board as a bare clickable Card with no
      // actions of its own (MoodBoardsClient.tsx:60-85). Count real cards
      // instead (`.shadow-card`, same class this file already keys off of
      // below).
      await expect(page.locator(".shadow-card")).toHaveCount(api.boards.length);
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

    // Stale: "New Mood Board" no longer opens a Dialog -- it navigates to a
    // real create route (MoodBoardsClient.tsx:51: router.push to
    // `/mood-boards/new`).
    await page.getByRole("button", { name: "New Mood Board" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New Mood Board" })).toBeVisible();
    await fieldInput(page, "Title").fill(boardTitle);
    await fieldInput(page, "Room / Area (optional)").fill("Living Room");
    // Stale: there is no dialog to have its own "Create" button -- the
    // create screen submits via the shared ObjectScreen footer's generic
    // "Save" control (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100).
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/mood-boards") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("Mood board created")).toBeVisible();

    // Stale: creation now lands on the board's own Object Page
    // (MoodBoardCreateClient.tsx:28: router.push(`/mood-boards/${board.id}`))
    // instead of returning to the list, so there is no more per-card
    // locator to scope into -- assert straight on the page.
    await expect(page.getByRole("heading", { level: 1, name: boardTitle })).toBeVisible();
    await expect(page.getByText("draft")).toBeVisible();
    await expect(page.getByText("No items yet.")).toBeVisible();

    // Stale: item entry is now inline on the Object Page itself (Label /
    // Notes (optional) inputs + one "Add Item" button per board,
    // MoodBoardObjectClient.tsx:196-199) -- the old shared "Add Item"
    // dialog keyed by board no longer exists.
    await fieldInput(page, "Label").fill(itemLabel);
    await fieldInput(page, "Notes (optional)").fill("E2E test note");
    const [itemRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/mood-boards\/[^/]+$/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Item" }).click(),
    ]);
    expect(itemRes.status()).toBe(201);
    await expect(page.getByText(itemLabel)).toBeVisible();

    // Status transition: draft -> shared. Same PATCH contract as before,
    // just relocated to the Object Page's display view
    // (MoodBoardObjectClient.tsx:169).
    const [shareRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/mood-boards\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Share with Client" }).click(),
    ]);
    expect(shareRes.status()).toBe(200);
    await expect(page.getByText("shared")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Approved" })).toBeVisible();

    // Stale: we're on the Object Page (/mood-boards/[id]) now, not the list
    // -- a reload() would just re-fetch this same board, not the list's GET.
    // Navigate back to the list explicitly instead.
    const [afterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/mood-boards?") && r.request().method() === "GET"),
      page.goto(`/mood-boards?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const after = (await afterRes.json()) as { boards: { title: string; status: string; items: { label: string | null }[] }[] };
    expect(after.boards.length).toBe(before.boards.length + 1);
    const created = after.boards.find((b) => b.title === boardTitle);
    expect(created?.status).toBe("shared");
    expect(created?.items.some((i) => i.label === itemLabel)).toBeTruthy();
  });
});
