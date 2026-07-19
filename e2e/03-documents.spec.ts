import { test, expect } from "@playwright/test";
import { apiGet, DEFAULT_PROJECT, PROJECTS } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /documents (DocumentsClient.tsx) is project-scoped, read-only, backed by
// VERIDIAN's generic `documents` table (root:true routing bypass, see
// PHASE1_SEED_REPORT.md). Its only real control is the category Select.
//
// The org sidebar's own ProjectSwitcher (a second, unrelated combobox) also
// renders on this page once its own async /api/projects fetch resolves (this
// org has 4 projects) -- getByRole("combobox") alone is ambiguous once that
// lands. Scoped here via the descriptive <p> that is this Select's actual
// DOM sibling in DocumentsClient.tsx's JSX, same pattern as
// helpers.ts's fieldInput() and 02-permits.spec.ts's windowSelect().
function categorySelect(page: import("@playwright/test").Page) {
  return page.locator("p", { hasText: "Documents linked directly to this project" }).locator("xpath=following-sibling::*[1]");
}

test.describe("documents", () => {
  test("renders the real per-project document list for the default project", async ({ page }) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/documents?") && r.request().method() === "GET"),
      page.goto(`/documents?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const api = (await res.json()) as { documents: { category: string }[] };
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
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
        await expect(page.getByText("No documents found for this project.")).toBeVisible();
      } else {
        await expect(page.locator("table tbody tr")).toHaveCount(body.documents.length);
        for (const d of body.documents) {
          expect(d.category).toBe(value);
        }
      }
    }
  });

  test("has no write controls (read-only by design)", async ({ page }) => {
    await page.goto(`/documents?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(new|add|create|upload)/i })).toHaveCount(0);
  });
});
