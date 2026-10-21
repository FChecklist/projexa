import { test, expect } from "@playwright/test";
import { AUDIT, createAuditProject, expectGuide, followFix, panel, pdfBuffer, readJson, saveButton, today } from "./support/guided-g3";
import { uniqueSuffix } from "./helpers";

// GUIDED ERRORS, G3 -- DOCUMENTS, DRAWINGS & 3D, PERMITS. The file faults (wrong type, too big, empty, no file), the date-order fault on permits,
// the connection-down fault, and "what I typed survives a reload". A browser never lets a page restore a chosen FILE, so after a reload the screen
// says "choose the file again" and every other value is back. All data is labelled AUDIT-G3 and never deleted.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g3-documents-drawings-permits.spec.ts

test.use({ storageState: "playwright/.auth/ceo.json" });

type Named = { name?: string; title?: string };
function rows(body: unknown, key: string): Named[] {
  const b = body as Record<string, unknown>;
  const v = b?.[key];
  return Array.isArray(v) ? (v as Named[]) : [];
}

test.describe("guided errors G3 - documents", () => {
  test("DOC1 a zip file is refused with its reason, Fix highlights the file box, a PDF then uploads and is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "doc-type");
    await page.goto(`/documents/upload?projectId=${project.id}`);
    await page.locator("#document-file").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
    await expectGuide(page, { id: "file-rejected", what: ".zip" });
    await followFix(page, { path: "/documents/upload", focus: "document-drop-zone" });

    const name = `${AUDIT} Doc ${uniqueSuffix()}`;
    await page.locator("#document-file").setInputFiles({ name: "site-note.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });
    await page.locator("#document-name").fill(name);
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{8,}/);
    const list = await readJson<unknown>(page.request, `/api/documents?projectScopeId=${project.id}`);
    expect(rows(list, "documents").some((d) => d.name === name)).toBe(true);
  });

  test("DOC2 an empty file is refused, a real file then uploads", async ({ page }) => {
    const project = await createAuditProject(page.request, "doc-empty");
    await page.goto(`/documents/upload?projectId=${project.id}`);
    await page.locator("#document-file").setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    await expectGuide(page, { id: "file-empty", what: "empty" });
    await followFix(page, { path: "/documents/upload", focus: "document-drop-zone" });
    await page.locator("#document-file").setInputFiles({ name: "full.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });
    await expect(panel(page)).toHaveCount(0);
  });

  test("DOC3 a file over the 25 MB limit is refused with both numbers", async ({ page }) => {
    const project = await createAuditProject(page.request, "doc-big");
    await page.goto(`/documents/upload?projectId=${project.id}`);
    await page.locator("#document-file").setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 0x20) });
    await expectGuide(page, { id: "file-rejected", what: /the limit is 25 MB/ });
    await followFix(page, { path: "/documents/upload", focus: "document-drop-zone" });
  });

  test("DOC4 upload while the connection is down: explained, the typed name stays, Try again stores it", async ({ page, context }) => {
    const project = await createAuditProject(page.request, "doc-offline");
    const name = `${AUDIT} Offline ${uniqueSuffix()}`;
    await page.goto(`/documents/upload?projectId=${project.id}`);
    await page.locator("#document-file").setInputFiles({ name: "later.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });
    await page.locator("#document-name").fill(name);
    await context.setOffline(true);
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await expectGuide(page, { id: "docs-upload-offline" });
    await expect(page.locator("#document-name")).toHaveValue(name);
    await context.setOffline(false);
    await panel(page).getByTestId("guided-error-retry").click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{8,}/);
    const list = await readJson<unknown>(page.request, `/api/documents?projectScopeId=${project.id}`);
    expect(rows(list, "documents").some((d) => d.name === name)).toBe(true);
  });

  test("DOC5 what was typed survives a reload; the screen says to choose the file again", async ({ page }) => {
    const project = await createAuditProject(page.request, "doc-draft");
    const name = `${AUDIT} Draft ${uniqueSuffix()}`;
    await page.goto(`/documents/upload?projectId=${project.id}`);
    await page.locator("#document-file").setInputFiles({ name: "d.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });
    await page.locator("#document-name").fill(name);
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#document-name")).toHaveValue(name);
    await expect(page.getByTestId("document-rechoose")).toBeVisible();
  });
});

test.describe("guided errors G3 - drawings", () => {
  test("DRW1 a wrong file type for a DWG drawing is refused, Fix highlights the file box, the typed values stay", async ({ page }) => {
    const project = await createAuditProject(page.request, "drawing-type");
    const name = `${AUDIT} Plan ${uniqueSuffix()}`;
    await page.goto(`/drawings/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#drawingNo").fill("AR-101");
    await page.locator("#rev").fill("A");
    await page.locator("#file").setInputFiles({ name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("not a drawing") });
    await expectGuide(page, { id: "file-rejected" });
    await followFix(page, { path: "/drawings/new", focus: "file" });
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#drawingNo")).toHaveValue("AR-101");
    await expect(page.locator("#rev")).toHaveValue("A");
  });

  test("DRW2 an empty drawing file is refused", async ({ page }) => {
    const project = await createAuditProject(page.request, "drawing-empty");
    await page.goto(`/drawings/new?projectId=${project.id}`);
    await page.locator("#file").setInputFiles({ name: "empty.dwg", mimeType: "application/octet-stream", buffer: Buffer.alloc(0) });
    await expectGuide(page, { id: "file-empty" });
    await followFix(page, { path: "/drawings/new", focus: "file" });
  });

  test("DRW3 the drawing number, revision and name survive a reload (the file must be chosen again)", async ({ page }) => {
    const project = await createAuditProject(page.request, "drawing-draft");
    const name = `${AUDIT} Section ${uniqueSuffix()}`;
    await page.goto(`/drawings/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#drawingNo").fill("ST-204");
    await page.locator("#rev").fill("B");
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#drawingNo")).toHaveValue("ST-204");
    await expect(page.locator("#rev")).toHaveValue("B");
    await expect(page.getByTestId("drawing-rechoose")).toBeVisible();
  });
});

test.describe("guided errors G3 - permits", () => {
  test("PRM1 an end date before the issue date is explained, Fix highlights the end date, the corrected permit is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "permit-dates");
    const name = `${AUDIT} Permit ${uniqueSuffix()}`;
    await page.goto(`/permits/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#issueDate").fill(today());
    await page.locator("#endDate").fill(today(-5));
    await page.locator("#endDate").blur();
    await page.locator("#file").setInputFiles({ name: "permit.pdf", mimeType: "application/pdf", buffer: pdfBuffer() });

    await expectGuide(page, { id: "permit-expiry-order", what: /before the issue date/ });
    await followFix(page, { path: "/permits/new", focus: "endDate" });
    await expect(page.locator("#name")).toHaveValue(name);

    await page.locator("#endDate").fill(today(365));
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForURL(/\/permits\/[0-9a-f-]{8,}/);
    const list = await readJson<unknown>(page.request, `/api/permits?projectId=${project.id}&all=true`);
    expect(rows(list, "permits").some((p) => p.name === name)).toBe(true);
  });

  test("PRM2 an empty PDF is refused", async ({ page }) => {
    const project = await createAuditProject(page.request, "permit-empty");
    await page.goto(`/permits/new?projectId=${project.id}`);
    await page.locator("#file").setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    await expectGuide(page, { id: "file-empty" });
    await followFix(page, { path: "/permits/new", focus: "file" });
  });

  test("PRM3 a Word file instead of a PDF is refused with its reason", async ({ page }) => {
    const project = await createAuditProject(page.request, "permit-type");
    await page.goto(`/permits/new?projectId=${project.id}`);
    await page.locator("#file").setInputFiles({ name: "permit.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK") });
    await expectGuide(page, { id: "file-rejected", what: ".docx" });
    await followFix(page, { path: "/permits/new", focus: "file" });
  });

  test("PRM4 what was typed survives a reload (the PDF must be chosen again)", async ({ page }) => {
    const project = await createAuditProject(page.request, "permit-draft");
    const name = `${AUDIT} Draft permit ${uniqueSuffix()}`;
    await page.goto(`/permits/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#issueDate").fill(today());
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#issueDate")).toHaveValue(today());
    await expect(page.getByTestId("permit-rechoose")).toBeVisible();
  });
});
