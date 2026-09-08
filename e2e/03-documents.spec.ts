import { test, expect } from "@playwright/test";
import { apiGet, DEFAULT_PROJECT, PROJECTS } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /documents (DocumentsClient.tsx) is project-scoped, real per-project data
// backed by VERIDIAN's generic `documents` table (root:true routing bypass,
// see PHASE1_SEED_REPORT.md and api/documents/route.ts:9-13).
//
// STALE-TEST FIX (2026-09-08): this module used to be read-only (this
// comment used to say so). Wave 143 gave VERIDIAN's /documents a real POST
// (api/documents/route.ts:9-13, 47-61) and the 2026-08-30 "real-screen
// conversion" (DocumentUploadClient.tsx:1-4) replaced the old "Upload
// Document" Dialog popup with a dedicated /documents/upload route
// (DocumentsClient.tsx:418 does router.push(`/documents/upload?...`),
// matching module-catalogue.ts's documents.upload leaf) -- the same
// chain-sentence Project > Module > New <thing> navigation 04-vendors.spec.ts
// documents for /vendors/new. See the last test below, which used to assert
// the opposite.
//
// STALE-TEST FIX (2026-09-08): the category Select used to sit directly on
// the page, addressed via a <p> sibling. R67 D-14 (DocumentsClient.tsx:49-63)
// replaced the unlabelled dropdown-beside-a-"+Upload"-button with the
// standard Filter | Export | + New header trio -- Category now lives inside
// a collapsible Filter panel (DocumentsClient.tsx:398-500), behind a real
// id/htmlFor pair, not the old <p> (whose text has also changed -- the
// paragraph now reads "Documents that belong to this project..." at
// DocumentsClient.tsx:390-393, not "Documents linked directly to this
// project"). categorySelect() below now locates the Select directly by its
// id; callers must open the Filter panel first (it is not visible by
// default).
//
// STALE-TEST FIX (2026-09-08): the DEFAULT ("all categories") read is now
// SERVER-SEEDED (R67 F-18): module-list-source.ts's fetchDocumentsList()
// (module-list-source.ts:371-384) calls VERIDIAN directly from the server
// and hands the rows to DocumentsClient as `initial`; use-list-read.ts's
// read effect (use-list-read.ts:223-229) then SKIPS its own fetch for that
// exact url. No browser-visible GET to /api/documents fires on first paint
// any more, so the first test below no longer races page.goto() against a
// client fetch that no longer happens -- it cross-checks against a direct
// API read instead, the same pattern 04-vendors.spec.ts's first test uses.
//
// The org sidebar's own ProjectSwitcher (a second, unrelated combobox) also
// renders on this page once its own async /api/projects fetch resolves (this
// org has 4 projects) -- getByRole("combobox") alone is ambiguous once that
// lands.
function categorySelect(page: import("@playwright/test").Page) {
  // STALE: used to locate the Select via its <p> sibling's text (see above --
  // that text no longer exists, and the sibling relationship doesn't hold any
  // more either now the Select lives inside the Filter panel two levels
  // down). The Select now carries a real id
  // (DocumentsClient.tsx:432 `<SelectTrigger id="documents-filter-category">`,
  // paired with DocumentsClient.tsx:427's `<label htmlFor="documents-filter-category">`)
  // -- address it directly. This is a genuine label/id pair, unlike the
  // shadcn <Label> gap helpers.ts's fieldByLabel()/fieldInput() document
  // elsewhere in this app.
  return page.locator("#documents-filter-category");
}

test.describe("documents", () => {
  test("renders the real per-project document list for the default project", async ({ page }) => {
    // STALE: this used to race page.goto() against a client-side GET to
    // /api/documents (see describe-level comment: that fetch no longer
    // happens on first paint). Read the same server-seeded query directly
    // instead, then compare it against what the page actually rendered.
    const api = await apiGet<{ documents: { category: string }[] }>(
      page,
      `/api/documents?projectScopeId=${DEFAULT_PROJECT.id}`
    );
    await page.goto(`/documents?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    // STALE: the category Select isn't visible until the Filter panel is
    // opened any more (see describe-level comment).
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(categorySelect(page)).toContainText("All categories");

    expect(api.documents.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator("table tbody tr")).toHaveCount(api.documents.length);
  });

  test("documents are real and match seeded per-project totals across all 4 projects", async ({ page }) => {
    // PHASE1_SEED_REPORT.md: 25 documents seeded org-wide in Batch 4.
    // Verified during authoring these split 7/7/7/4 across the 4 projects
    // (confirmed live via each project's /api/documents call) -- asserting
    // each project's minimum here is a real, per-project cross-check, not
    // just an org-wide total that could hide an empty project.
    //
    // linkedEntityType=project&linkedEntityId= is still a real, distinct
    // query this route accepts (api/documents/route.ts:18-34: either
    // linkedEntityId or projectScopeId satisfies the required-param check) --
    // it asks for documents filed DIRECTLY against the project, which is
    // narrower than the per-project screen's own projectScopeId query (that
    // one also includes documents filed against the project's permits/RFIs/
    // meetings, per R67 D-14). Not stale: still the right call for "documents
    // linked directly to this project", a real and different question.
    const expectedMinimums: Record<string, number> = {
      [PROJECTS.meridianHeights.id]: 7,
      [PROJECTS.emeraldBusinessPark.id]: 7,
      [PROJECTS.riversideSchool.id]: 7,
      [PROJECTS.highwayWarehouse.id]: 4,
    };
    let total = 0;
    for (const project of Object.values(PROJECTS)) {
      const api = await apiGet<{ documents: unknown[] }>(
        page,
        `/api/documents?linkedEntityType=project&linkedEntityId=${project.id}`
      );
      expect(api.documents.length, `documents for ${project.name}`).toBeGreaterThanOrEqual(expectedMinimums[project.id]);
      total += api.documents.length;
    }
    expect(total).toBeGreaterThanOrEqual(25);
  });

  test("category filter re-fetches and only ever shows the selected category", async ({ page }) => {
    await page.goto(`/documents?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    // STALE: the category Select isn't visible until the Filter panel is
    // opened any more (see describe-level comment) -- open it once, it stays
    // open across the category changes below.
    await page.getByRole("button", { name: "Filter" }).click();

    // Real categories confirmed present in this project's seeded documents:
    // other, drawing, contract, site_photo. "permit"/"certificate"/"license"
    // are real Select options but have zero matching seeded rows here (see
    // 02-permits.spec.ts's finding of 0 permit-category documents org-wide).
    for (const [value, label] of [
      ["drawing", "drawing"],
      ["contract", "contract"],
      ["site_photo", "site photo"],
      ["permit", "permit"],
    ] as const) {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`category=${value}`)),
        categorySelect(page).click().then(() => page.getByRole("option", { name: label, exact: true }).click()),
      ]);
      const body = (await response.json()) as { documents: { category: string }[] };
      if (body.documents.length === 0) {
        // STALE: "No documents found for this project." doesn't exist any
        // more. R67 D-13 split this into two real, distinct empty states
        // (emptyStateText(), DocumentsClient.tsx:201-214) -- with a category
        // selected the message is `No ${category words} documents for
        // ${projectName}.`, which is real per-project text, not a generic
        // sentence.
        await expect(page.getByText(`No ${label} documents for ${DEFAULT_PROJECT.name}.`)).toBeVisible();
      } else {
        await expect(page.locator("table tbody tr")).toHaveCount(body.documents.length);
        for (const d of body.documents) {
          expect(d.category).toBe(value);
        }
      }
    }
  });

  // STALE: this used to assert NO write control existed ("read-only by
  // design") -- see describe-level comment for what changed. Rewritten to
  // assert the real create flow: a page, not a dialog, matching
  // 04-vendors.spec.ts's "New Vendor" fix for the same architecture change.
  test("has a real create flow: + New Document opens the dedicated /documents/upload page, not a modal", async ({ page }) => {
    await page.goto(`/documents?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    const newDocumentButton = page.getByRole("button", { name: "New Document" });
    await expect(newDocumentButton).toBeVisible();
    await newDocumentButton.click();

    // Real navigation to a dedicated route (DocumentsClient.tsx:418's
    // router.push), not a dialog opening in place.
    await expect(page).toHaveURL(new RegExp(`/documents/upload\\?projectId=${DEFAULT_PROJECT.id}`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // DocumentUploadClient renders the shared-kit ObjectScreen
    // (DocumentUploadClient.tsx:232-247, title="New Document") -- the same
    // component 04-vendors.spec.ts's create screen uses, whose create-mode
    // footer is always a plain "Save" button.
    await expect(page.getByRole("heading", { level: 1, name: "New Document" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
