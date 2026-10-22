import { test, expect } from "@playwright/test";
import { AUDIT, createAuditProject, expectGuide, followFix, goBack, panel, readJson, saveButton, today } from "./support/guided-g3";
import { uniqueSuffix } from "./helpers";

// GUIDED ERRORS, G3 -- MATERIALS. One test per fault a real person can make on the material screens. Each test: triggers the fault through the real
// UI, checks the complete description (title / what / why / numbered steps), the Fix button's address and the highlighted element, the way back with
// the typed values intact, and that the corrected save was PERSISTED (re-read through the API). All data is labelled AUDIT-G3 and never deleted.
//
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g3-materials.spec.ts

test.use({ storageState: "playwright/.auth/ceo.json" });

type Material = { id: string; name: string; unit: string; unitCost: string | number | null; reorderLevel?: string | number | null };

async function addMaterial(page: import("@playwright/test").Page, projectId: string, name: string, unit = "bag"): Promise<Material> {
  const res = await page.request.post("/api/materials/master", { data: { projectId, name, unit, unitCost: 10 } });
  expect(res.ok(), `creating the audit material answered ${res.status()}`).toBe(true);
  return (await res.json()) as Material;
}

test.describe("guided errors G3 - materials", () => {
  test("M1 new material: a negative unit cost is explained, the typed name stays, the corrected save is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "materials");
    const name = `${AUDIT} Cement ${uniqueSuffix()}`;
    await page.goto(`/materials/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#unit").selectOption("bag");
    await page.locator("#unitCost").fill("-5");
    await saveButton(page).click();

    await expectGuide(page, { id: "materials-unit-cost-invalid", what: "-5" });
    // the exact place: the same screen, the Unit Cost box, outlined
    await followFix(page, { path: "/materials/new", focus: "unitCost" });
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#unit")).toHaveValue("bag");

    await page.locator("#unitCost").fill("12.5");
    await saveButton(page).click();
    await page.waitForURL(/\/materials\/[0-9a-z-]{16,}/);

    const list = await readJson<{ materials: Material[] }>(page.request, `/api/materials/master?projectId=${project.id}`);
    const saved = list.materials.find((m) => m.name === name);
    expect(saved, "the corrected material is stored").toBeTruthy();
    expect(Number(saved!.unitCost)).toBe(12.5);
  });

  test("M2 new material: a negative reorder level is explained and highlights the reorder box", async ({ page }) => {
    const project = await createAuditProject(page.request, "materials-reorder");
    const name = `${AUDIT} Steel ${uniqueSuffix()}`;
    await page.goto(`/materials/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#unit").selectOption("bag");
    await page.locator("#reorderLevel").fill("-3");
    await saveButton(page).click();

    await expectGuide(page, { id: "materials-reorder-negative" });
    await followFix(page, { path: "/materials/new", focus: "reorderLevel" });
    await expect(page.locator("#name")).toHaveValue(name);
    await page.locator("#reorderLevel").fill("20");
    await saveButton(page).click();
    await page.waitForURL(/\/materials\/[0-9a-z-]{16,}/);

    const list = await readJson<{ materials: Material[] }>(page.request, `/api/materials/master?projectId=${project.id}`);
    expect(Number(list.materials.find((m) => m.name === name)?.reorderLevel)).toBe(20);
  });

  test("M3 receipt: a quantity of zero is explained, the material and date stay, the corrected receipt is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "receipt-qty");
    const material = await addMaterial(page, project.id, `${AUDIT} Sand ${uniqueSuffix()}`);
    await page.goto(`/materials/receipts/new?projectId=${project.id}`);
    // a project with exactly one material has it chosen already
    await page.locator("#quantity").fill("0");
    await saveButton(page).click();

    await expectGuide(page, { id: "materials-qty-not-positive", what: '"0"' });
    await followFix(page, { path: "/materials/receipts/new", focus: "quantity" });
    await page.locator("#quantity").fill("25");
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/materials");

    const receipts = await readJson<{ receipts: { materialId: string; quantity: string | number }[] }>(page.request, `/api/materials?projectId=${project.id}`);
    expect(receipts.receipts.some((r) => r.materialId === material.id && Number(r.quantity) === 25)).toBe(true);
  });

  test("M4 receipt: a date in the future is explained and highlights the date box", async ({ page }) => {
    const project = await createAuditProject(page.request, "receipt-date");
    const material = await addMaterial(page, project.id, `${AUDIT} Brick ${uniqueSuffix()}`);
    await page.goto(`/materials/receipts/new?projectId=${project.id}`);
    await page.locator("#receivedDate").fill(today(30));
    await page.locator("#quantity").fill("40");
    await saveButton(page).click();

    await expectGuide(page, { id: "input-date-in-future" });
    await followFix(page, { path: "/materials/receipts/new", focus: "receivedDate" });
    await expect(page.locator("#quantity")).toHaveValue("40");
    await page.locator("#receivedDate").fill(today());
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/materials");
    const receipts = await readJson<{ receipts: { materialId: string; quantity: string | number }[] }>(page.request, `/api/materials?projectId=${project.id}`);
    expect(receipts.receipts.some((r) => r.materialId === material.id && Number(r.quantity) === 40)).toBe(true);
  });

  test("M5 receipt on a project with no materials: explained, Fix goes to New Material, Back returns with the quantity typed", async ({ page }) => {
    const project = await createAuditProject(page.request, "receipt-nomat");
    await page.goto(`/materials/receipts/new?projectId=${project.id}`);
    await page.locator("#quantity").fill("77");
    await expectGuide(page, { id: "materials-none-yet", fix: /Add a material/ });

    // to the exact place, outlined
    await followFix(page, { path: "/materials/new", focus: "name" });
    const name = `${AUDIT} Gravel ${uniqueSuffix()}`;
    await page.locator("#name").fill(name);
    await page.locator("#unit").selectOption("bag");
    await saveButton(page).click();
    await page.waitForURL(/\/materials\/[0-9a-z-]{16,}/);

    // the way back, with what was typed still in place
    await goBack(page, "/materials/receipts/new");
    await expect(page.locator("#quantity")).toHaveValue("77");
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/materials");
    const receipts = await readJson<{ receipts: { quantity: string | number }[] }>(page.request, `/api/materials?projectId=${project.id}`);
    expect(receipts.receipts.some((r) => Number(r.quantity) === 77)).toBe(true);
  });

  test("M6 issue more than is in stock: explained with the real figure, Fix highlights the quantity, the corrected issue is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "issue-stock");
    const material = await addMaterial(page, project.id, `${AUDIT} Paint ${uniqueSuffix()}`);
    const rec = await page.request.post("/api/materials", { data: { projectId: project.id, materialId: material.id, receivedDate: today(), quantity: 10 } });
    expect(rec.ok()).toBe(true);

    await page.goto(`/materials/issues/new?projectId=${project.id}&materialId=${material.id}`);
    await expect(page.locator('input[name="quantity"]')).toHaveCount(1); // wait until the page has settled (a half-hydrated page can hold the form twice for a moment)
    await page.locator('input[name="quantity"]').fill("50");
    await page.getByRole("button", { name: /^Save/ }).first().click();

    // the form refuses it itself once the stock figure has loaded; if the figure was not there yet the server's own refusal gets the same advice (id ends -server)
    await expectGuide(page, { what: "10" });
    await expect(panel(page)).toHaveAttribute("data-guide-id", /^materials-issue-more-than-stock/);
    await followFix(page, { path: "/materials/issues/new", focus: "quantity" });
    await page.locator('input[name="quantity"]').fill("4");
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForURL((u) => u.pathname === "/materials");
    const issues = await readJson<{ issues: { materialId: string; quantity: string | number }[] }>(page.request, `/api/materials/issues?projectId=${project.id}`);
    expect(issues.issues.some((i) => i.materialId === material.id && Number(i.quantity) === 4)).toBe(true);
  });

  test("M7 issue when nothing is on hand: explained, Fix goes to Record Receipt", async ({ page }) => {
    const project = await createAuditProject(page.request, "issue-empty");
    await addMaterial(page, project.id, `${AUDIT} Tile ${uniqueSuffix()}`);
    await page.goto(`/materials/issues/new?projectId=${project.id}`);
    await expectGuide(page, { id: "materials-nothing-on-hand", fix: /Record a receipt/ });
    await followFix(page, { path: "/materials/receipts/new", focus: "materialId" });
  });

  test("M8 edit material: an empty name is explained and highlights the name box", async ({ page }) => {
    const project = await createAuditProject(page.request, "material-edit");
    const material = await addMaterial(page, project.id, `${AUDIT} Wire ${uniqueSuffix()}`);
    await page.goto(`/materials/${material.id}?projectId=${project.id}`);
    await page.getByRole("button", { name: /^Edit/ }).first().click();
    await page.locator("#material-name").fill("");
    // the screen no longer lets an empty name be sent: Save closes and its own words name what is missing (the same design as M10 on the new-material form)
    const save = page.getByRole("button", { name: /^Save/ }).first();
    await expect(save).toBeDisabled();
    await expect(save).toContainText(/Name/);
    await page.locator("#material-name").fill(`${AUDIT} Wire renamed`);
    await expect(save).toBeEnabled();
  });

  test("M9 receipt while the connection is down: explained, nothing lost, Try again stores it", async ({ page, context }) => {
    const project = await createAuditProject(page.request, "receipt-offline");
    const material = await addMaterial(page, project.id, `${AUDIT} Pipe ${uniqueSuffix()}`);
    await page.goto(`/materials/receipts/new?projectId=${project.id}&materialId=${material.id}`);
    // with a single material on the project the Material box is still empty on arrival: the person chooses it (Save names it as missing until then)
    await page.getByRole("combobox", { name: /Material/ }).click();
    await page.getByRole("option").first().click();
    await page.locator("#quantity").fill("12");
    await context.setOffline(true);
    await saveButton(page).click();
    await expectGuide(page, { id: "offline" });
    await expect(page.locator("#quantity")).toHaveValue("12");
    await context.setOffline(false);
    await panel(page).getByTestId("guided-error-retry").click();
    await page.waitForURL((u) => u.pathname === "/materials");
    const receipts = await readJson<{ receipts: { materialId: string; quantity: string | number }[] }>(page.request, `/api/materials?projectId=${project.id}`);
    expect(receipts.receipts.some((r) => r.materialId === material.id && Number(r.quantity) === 12)).toBe(true);
  });

  test("M10 new material: a name of only spaces and no unit keep Save closed and the button names what is missing", async ({ page }) => {
    const project = await createAuditProject(page.request, "material-required");
    await page.goto(`/materials/new?projectId=${project.id}`);
    await page.locator("#name").fill("     ");
    const save = saveButton(page);
    await expect(save).toBeDisabled();
    await expect(save).toContainText("Name");
    await expect(save).toContainText("Unit");
    await page.locator("#name").fill(`${AUDIT} Spaces ${uniqueSuffix()}`);
    await expect(save).toContainText("Unit");
    await expect(save).not.toContainText("Name");
  });
});
