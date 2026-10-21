import { test, expect, type Page } from "@playwright/test";
import { AUDIT, expectGuidedPanel, expectHighlighted, makeAuditProject, openOnline, panel, type ProjectRef, type Session } from "./support/guided";

// GUIDED ERRORS, group G1 -- Import BOQ from Excel (/scope/import) and Make a project from a file (/projects/from-file), through the real screens.
// I-xx cases. Every fault: the panel (what happened, why, steps), the file box outlined, nothing sent when the form can see the fault itself, the
// chosen file/title kept; after the fix the BOQ is IMPORTED and re-read from the server.

test.describe.configure({ mode: "serial" });

let S: Session;
let proj: ProjectRef;
test.beforeAll(async ({ browser }) => {
  S = await openOnline(browser, "finance");
  proj = await makeAuditProject(S.page, "import");
});
test.afterAll(async () => {
  await S?.context.close();
});

const csv = (rows: string[]) => ({ name: "boq.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n") + "\n") });
const GOOD = csv(["Code,Description,Unit,Qty,Rate", `I-1,${AUDIT} import line 1,m3,10,5`, `I-2,${AUDIT} import line 2,m3,4,2.5`]);
const save = (page: Page) => page.getByRole("button", { name: /^Save/ });
const NOT_A_NUMBER = csv(["Code,Description,Unit,Qty,Rate", `I-1,${AUDIT} bad row,m3,abc,5`]);

async function openImport(page: Page) {
  await page.goto(`/scope/import?projectId=${proj.id}`);
  await expect(page.locator("#import-file")).toBeVisible({ timeout: 60_000 });
}
let sent: string[] = [];
function watch(page: Page) {
  sent = [];
  page.removeAllListeners("request");
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/scope/import") sent.push(r.url());
  });
}

test("I-01 no file chosen: Save is off and says what to do", async () => {
  const page = S.page;
  await openImport(page);
  await expect(save(page)).toBeDisabled();
  await expect(save(page)).toContainText(/Choose a file/);
});

test("I-02 a PDF instead of a workbook: the panel says what can be imported, the file box is outlined, nothing is sent", async () => {
  const page = S.page;
  await openImport(page);
  watch(page);
  await page.locator("#import-file").setInputFiles({ name: "boq.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expectGuidedPanel(page, { id: "import-wrong-type-form", what: /Only an \.xlsx workbook or a \.csv file can be imported/, where: /file box/ });
  await expectHighlighted(page, "#import-file");
  expect(sent).toHaveLength(0);
  await expect(save(page)).toBeDisabled();
});

test("I-03 an old .xls workbook is named as such", async () => {
  const page = S.page;
  await openImport(page);
  watch(page);
  await page.locator("#import-file").setInputFiles({ name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
  await expectGuidedPanel(page, { id: "import-wrong-type-form", what: /old Excel \.xls workbook/ });
  expect(sent).toHaveLength(0);
});

test("I-04 an empty file (0 bytes)", async () => {
  const page = S.page;
  await openImport(page);
  watch(page);
  await page.locator("#import-file").setInputFiles({ name: "empty.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(0) });
  await expectGuidedPanel(page, { id: "import-empty-file-form", what: /empty \(0 bytes\)/ });
  await expectHighlighted(page, "#import-file");
  expect(sent).toHaveLength(0);
});

test("I-05 a file over 10 MB: refused with its size, before it is sent", async () => {
  const page = S.page;
  await openImport(page);
  watch(page);
  await page.locator("#import-file").setInputFiles({ name: "huge.csv", mimeType: "text/csv", buffer: Buffer.alloc(11 * 1024 * 1024, 97) });
  await expectGuidedPanel(page, { id: "import-too-big-form", what: /11\.0 MB/ });
  expect(sent).toHaveLength(0);
});

test("I-06 a workbook without the Description column: the server's refusal is a guided panel, the file box is outlined, the person can choose another file", async () => {
  const page = S.page;
  await openImport(page);
  await page.locator("#import-file").setInputFiles(csv(["Apple,Banana", "1,2"]));
  await expectGuidedPanel(page, { id: "import-column-missing" });
  await expectHighlighted(page, "#import-file");
  await expect(save(page)).toBeDisabled();
});

test("I-07 a workbook with headings but no lines", async () => {
  const page = S.page;
  await openImport(page);
  await page.locator("#import-file").setInputFiles(csv(["Code,Description,Unit,Qty,Rate"]));
  await expectGuidedPanel(page);
  await expectHighlighted(page, "#import-file");
  await expect(save(page)).toBeDisabled();
});

test("I-08 a row whose quantity is not a number: the rows that cannot be imported are told in full; the corrected file imports and the BOQ is re-read from the server", async () => {
  const page = S.page;
  await openImport(page);
  await page.locator("#import-file").setInputFiles(NOT_A_NUMBER);
  const p = await expectGuidedPanel(page, { id: "import-rows-blocked-form", what: /cannot be imported/, where: /file box/ });
  await expect(p.getByTestId("guided-error-what")).toContainText(/Row \d+/);
  await expectHighlighted(page, "#import-file");
  await expect(save(page)).toBeDisabled();
  // the title the person typed is kept while the file is replaced
  await page.locator("#import-title").fill(`${AUDIT} imported boq`);
  await page.locator("#import-file").setInputFiles(GOOD);
  await expect(page.getByText("2 lines ready, 0 with errors")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#import-title")).toHaveValue(`${AUDIT} imported boq`);
  await expect(page.getByTestId("guided-error")).toHaveCount(0);
  await save(page).click();
  await expect(page).toHaveURL(/\/scope\/[0-9a-f-]{8,}\?imported=/, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const body = (await (await page.request.get(`/api/scope/${id}`)).json()) as { title: string; lineItems: { description: string }[] };
  expect(body.title).toBe(`${AUDIT} imported boq`);
  expect(body.lineItems.map((l) => l.description).sort()).toEqual([`${AUDIT} import line 1`, `${AUDIT} import line 2`]);
});

test("I-09 the server is down at the moment of import: the panel and Try again; the retry imports exactly one BOQ", async () => {
  const page = S.page;
  await openImport(page);
  const title = `${AUDIT} import retry`;
  await page.locator("#import-title").fill(title);
  await page.locator("#import-file").setInputFiles(GOOD);
  await expect(page.getByText("2 lines ready, 0 with errors")).toBeVisible({ timeout: 60_000 });
  let failed = 0;
  await page.route(
    (u) => u.pathname === "/api/scope/import" && !u.search.includes("dryRun"),
    async (route) => {
      if (failed === 0) {
        failed += 1;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The construction data service did not respond in time." }) });
      }
      return route.fallback();
    }
  );
  await save(page).click();
  await expectGuidedPanel(page, { what: /did not respond in time/, retry: true });
  await expect(page.getByText("2 lines ready, 0 with errors")).toBeVisible(); // the preview is kept
  await panel(page).getByTestId("guided-error-retry").click();
  await expect(page).toHaveURL(/\/scope\/[0-9a-f-]{8,}\?imported=/, { timeout: 90_000 });
  const list = (await (await page.request.get(`/api/scope?projectId=${proj.id}`)).json()) as { boqs?: { title: string }[] };
  expect((list.boqs ?? []).filter((b) => b.title === title)).toHaveLength(1);
});

test("I-10 Make a project from a file: a PDF is refused beside the box and in the panel; Read the file stays off", async () => {
  const page = S.page;
  await page.goto("/projects/from-file");
  await expect(page.getByTestId("doc-file")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("doc-file").setInputFiles({ name: "boq.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(page.getByTestId("doc-file-error")).toContainText(/Wrong type/);
  await expectGuidedPanel(page, { id: "doc-file-invalid-form", what: /cannot be read here/, where: /Project file/ });
  await expectHighlighted(page, "#doc-file");
  await expect(page.getByTestId("doc-read")).toBeDisabled();
});

test("I-11 Make a project from a file: a file over the size limit is refused with its size before anything is sent", async () => {
  const page = S.page;
  await page.goto("/projects/from-file");
  await expect(page.getByTestId("doc-file")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("doc-file").setInputFiles({ name: "huge.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(25 * 1024 * 1024, 97) });
  await expect(page.getByTestId("doc-file-error")).toContainText(/Too large/);
  await expectGuidedPanel(page, { id: "doc-file-invalid-form" });
  await expect(page.getByTestId("doc-read")).toBeDisabled();
});

test("I-12 Make a project from a file: an empty file is refused", async () => {
  const page = S.page;
  await page.goto("/projects/from-file");
  await expect(page.getByTestId("doc-file")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("doc-file").setInputFiles({ name: "empty.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(0) });
  await expect(page.getByTestId("doc-file-error")).toContainText(/empty/i);
  await expectGuidedPanel(page, { id: "doc-file-invalid-form" });
});

test("I-13 Make a project from a file as a plain member: the refusal is a guided panel that says who can do it", async ({ browser }) => {
  const member = await openOnline(browser, "hr");
  try {
    const page = member.page;
    await page.goto("/projects/from-file");
    await expect(page.getByTestId("doc-role-note")).toBeVisible({ timeout: 60_000 });
    await expectGuidedPanel(page, { id: "boq-role-too-low" });
  } finally {
    await member.context.close();
  }
});
