import { test, expect } from "@playwright/test";
import { apiGet, DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// STALE-TEST FIX (2026-09-08): every assertion in this file targeted a bug
// or a UI that no longer exists. Re-verified all of it directly against
// current source before rewriting (no dev server, no live requests, per
// this batch's scope):
//
// 1. The "Wiki never renders WikiClient, fails with 'Could not load
//    projects: Unauthorized'" bug this file used to document is fixed.
//    src/app/(app)/wiki/page.tsx:9-10 now calls getServerOrganizationId()
//    and passes it into resolveSelectedProject(projectId, organizationId) --
//    byte-for-byte the same pattern as src/app/(app)/kpis/page.tsx:9-10,
//    which this file's own old comment named as the correct reference.
//
// 2. The "missing organizationId" write bug this file's top comment used to
//    describe is also fixed. All four real write/read routes now pass
//    `organizationId: ctx.organizationId!` to callVeridian():
//    src/app/api/knowledge-base/route.ts:14 (GET), :27 (POST);
//    src/app/api/knowledge-base/[id]/route.ts:16 (GET), :29 (PATCH);
//    src/app/api/wiki/route.ts:15 (GET), :30 (POST);
//    src/app/api/wiki/[id]/route.ts:15 (GET), :28 (PATCH).
//
// 3. "New Page" is no longer a Dialog on either screen. Real-screen
//    conversion (2026-08-30, per both components' own header comments)
//    replaced it with a real route: KnowledgeBaseClient.tsx:90 and
//    WikiClient.tsx:64 both router.push() to a dedicated /knowledge-base/new
//    or /wiki/new screen (KnowledgeBaseCreateClient.tsx / WikiCreateClient.tsx,
//    both the shared kit ObjectScreen) -- the same chain-sentence
//    Project > Module > New <thing> architecture 04-vendors.spec.ts
//    documents for /vendors/new. There is no `role=dialog` anywhere in
//    either create flow.
//
// 4. The "per-user VERIDIAN session" disclosure banner this file asserted on
//    the Knowledge Base LIST page no longer renders there at all (grep of
//    KnowledgeBaseClient.tsx confirms). Creating a page no longer 401s --
//    KnowledgeBaseClient.tsx:14-19's own header comment: "create already
//    worked via a real isRealUser gate; only edit was ever actually
//    blocked, and that gap is now closed too." Wiki's equivalent banner
//    survives only as an info message on the Wiki Object (view) page
//    (WikiObjectClient.tsx:70-73), and even that text says "Creating new
//    pages is unaffected" -- only Edit is identity-bridge-blocked there,
//    which this file never tested and still doesn't. Both create screens
//    now genuinely persist (POST 201), so both are tested the real
//    write-persists way 04-vendors.spec.ts and 03-documents.spec.ts test
//    theirs, instead of asserting a 401 that no longer happens.
test.describe("Wiki (/wiki)", () => {
  test("renders the real per-project wiki list for the default project", async ({ page }) => {
    const api = await apiGet<{ pages: { title: string }[] }>(page, `/api/wiki?projectId=${DEFAULT_PROJECT.id}`);

    await page.goto(`/wiki?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Wiki" })).toBeVisible();

    // Disproves the old bug directly: this text (project-load failure from
    // the missing-organizationId bug, see file header) used to always
    // render here -- it must not any more.
    await expect(page.getByText("Could not load projects: Unauthorized")).toHaveCount(0);

    if (api.pages.length === 0) {
      await expect(page.getByText("No pages yet.")).toBeVisible();
    } else {
      // WikiClient.tsx renders pages as real <Table> rows.
      await expect(page.locator("table tbody tr")).toHaveCount(api.pages.length);
    }
    await expect(page.getByRole("button", { name: "New Page" })).toBeVisible();
  });

  test("creating a wiki page persists and is reflected after reload (real write)", async ({ page }) => {
    const before = await apiGet<{ pages: { title: string }[] }>(page, `/api/wiki?projectId=${DEFAULT_PROJECT.id}`);
    const title = `E2E Wiki Page ${uniqueSuffix()}`;

    await page.goto(`/wiki?projectId=${DEFAULT_PROJECT.id}`);

    // Stale: this used to open a Dialog. It now navigates to a dedicated
    // route -- see file header (WikiClient.tsx:64).
    await page.getByRole("button", { name: "New Page" }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/new\\?projectId=${DEFAULT_PROJECT.id}`));
    await expect(page.getByRole("heading", { level: 1, name: "New Wiki Page" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await fieldInput(page, "Title").fill(title);

    // Stale: this used to assert a 401 Unauthorized (missing organizationId
    // bug, see file header) -- the route genuinely creates the page now.
    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/wiki") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await expect(page.getByText("Page created")).toBeVisible();

    // WikiCreateClient.tsx:32 redirects to the new page's own Object Page on
    // success, whose title is the real value read back from the server, not
    // just the value we typed (WikiObjectClient.tsx:62).
    await expect(page).toHaveURL(/\/wiki\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    await page.goto(`/wiki?projectId=${DEFAULT_PROJECT.id}`);
    const after = await apiGet<{ pages: { title: string }[] }>(page, `/api/wiki?projectId=${DEFAULT_PROJECT.id}`);
    expect(after.pages.length).toBe(before.pages.length + 1);
    expect(after.pages.some((p) => p.title === title)).toBeTruthy();
  });
});

test.describe("Knowledge Base (/knowledge-base)", () => {
  test("renders the real knowledge base list (org-wide, no project needed)", async ({ page }) => {
    const api = await apiGet<{ pages: { title: string }[] }>(page, "/api/knowledge-base");

    await page.goto("/knowledge-base");
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge Base" })).toBeVisible();

    // Stale: the "per-user VERIDIAN session" disclosure banner used to
    // render on this list screen -- it's gone (see file header, point 4).
    await expect(page.getByText(/per-user VERIDIAN session/i)).toHaveCount(0);

    if (api.pages.length === 0) {
      await expect(page.getByText("No pages yet.")).toBeVisible();
    } else {
      // KnowledgeBaseClient.tsx:100-112 renders rows as plain buttons in a
      // divide-y list, not a <table> (unlike Wiki's WikiClient.tsx).
      await expect(page.locator("div.divide-y > button")).toHaveCount(api.pages.length);
    }
  });

  test("search control is real and returns the real empty result for a nonsense query", async ({ page }) => {
    await page.goto("/knowledge-base");
    await page.getByPlaceholder("Search…").fill("zzz-nonexistent-kb-query-zzz");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("No pages yet.")).toBeVisible({ timeout: 10_000 });
  });

  test("creating a knowledge base page persists and is reflected after reload (real write)", async ({ page }) => {
    const before = await apiGet<{ pages: { title: string }[] }>(page, "/api/knowledge-base");
    const title = `E2E KB Page ${uniqueSuffix()}`;

    await page.goto("/knowledge-base");

    // Stale: this used to open a Dialog (`page.getByRole("dialog")`). It now
    // navigates to a dedicated route -- see file header
    // (KnowledgeBaseClient.tsx:90).
    await page.getByRole("button", { name: "New Page" }).click();
    await expect(page).toHaveURL(/\/knowledge-base\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New Knowledge Base Page" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await fieldInput(page, "Title").fill(title);

    // Stale: this used to assert a 401 Unauthorized (missing organizationId
    // bug, see file header) -- the route genuinely creates the page now.
    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/knowledge-base") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await expect(page.getByText("Page created")).toBeVisible();

    // KnowledgeBaseCreateClient.tsx:27 redirects to the new page's own
    // Object Page on success, whose title is the real value read back from
    // the server (KnowledgeBaseObjectClient.tsx:108).
    await expect(page).toHaveURL(/\/knowledge-base\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    await page.goto("/knowledge-base");
    const after = await apiGet<{ pages: { title: string }[] }>(page, "/api/knowledge-base");
    expect(after.pages.length).toBe(before.pages.length + 1);
    expect(after.pages.some((p) => p.title === title)).toBeTruthy();
  });
});
