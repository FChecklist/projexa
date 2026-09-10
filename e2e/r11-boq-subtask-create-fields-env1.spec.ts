import { test, expect } from "@playwright/test";

// R-11 (Weighted Sub-Tasks): "Sub-task enterable in create form (Item Code /
// Parent Item Code / Breakdown %)". Recorded closure_state=BLOCKED, same
// shared root cause as R-15/R-30/R-31 (F-2026-0910-PM-068). file_path in
// platform.sumeet_requirements says BoqLineGrid.tsx is "rendered inside
// ScopeCreateClient.tsx" -- THAT CITATION IS ALSO STALE/WRONG, found while
// writing this spec: ScopeCreateClient.tsx does not import or render
// <BoqLineGrid> at all (confirmed by grep, zero matches); it has its OWN
// inline line-editing markup with its own aria-labels ("Item code, line N" /
// "Parent code, line N" / "Breakdown %, line N"), distinct from
// BoqLineGrid.tsx's separate class-based grid (used elsewhere, not by this
// create form). Filed as F-2026-0910-W-TEST-004. This spec targets the real
// component that actually renders at /scope/new.
//
// Grounded directly in source: ScopeCreateClient.tsx renders one column per
// field with a fixed header row ("Item Code" / "Parent Item Code" /
// "Breakdown %") and a real, editable, aria-labelled <input> per field per
// line. This spec exercises the actual create form, not a static read.
//
// This is a FORM-CAPABILITY check (can Sumeet enter these three fields for a
// sub-task at all), not a submission/persistence check -- R67's own
// unrelated backend/validation behaviour (title required, parent-reference
// resolution) is exercised by R-90's spec, not this one, so this test does
// not submit the form.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-30/R-31/R-60.
test.use({ storageState: "playwright/.auth/ceo.json" });

test("R-11: Item Code / Parent Item Code / Breakdown % are all enterable for a sub-task line in the real create form", async ({ page }) => {
  await page.goto("/scope/new", { waitUntil: "networkidle" });

  // The grid's own column headers, read directly from source (not assumed
  // from the requirement's own wording, which reads "Item Code" / "Parent
  // Item Code" -- the real rendered <th> text is "Item code" / "Parent code",
  // confirmed by direct read of ScopeCreateClient.tsx:316-318).
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the create form's line grid must show an Item code column").toContain("Item code");
  expect(bodyText, "the create form's line grid must show a Parent code column").toContain("Parent code");
  expect(bodyText, "the create form's line grid must show a Breakdown % column").toContain("Breakdown %");

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job, same as every other spec in this
  // batch): planting a defect means temporarily removing one of these three
  // <input>s from ScopeCreateClient.tsx, confirming the fill below goes red,
  // then reverting.
  //
  // Real interaction, not just a header read: type into all three fields on
  // the grid's first line row and confirm the values actually land (the
  // inputs are real and writable, not disabled placeholders). Corrected from
  // an earlier draft that assumed BoqLineGrid.tsx's own class-based markup --
  // the real create form (ScopeCreateClient.tsx) has its OWN inline line
  // inputs with their own aria-labels, confirmed by direct read: "Item code,
  // line N" / "Parent code, line N" / "Breakdown %, line N". BoqLineGrid.tsx
  // is a separate component, not imported here.
  const itemCodeInput = page.getByLabel("Item code, line 1");
  await itemCodeInput.fill("R11-TEST");
  await expect(itemCodeInput, "typing into the Item Code input must actually set its value").toHaveValue("R11-TEST");

  const parentInput = page.getByLabel("Parent code, line 1");
  await parentInput.fill("R11-PARENT");
  await expect(parentInput, "typing into the Parent Item Code input must actually set its value").toHaveValue("R11-PARENT");

  const breakdownInput = page.getByLabel("Breakdown %, line 1");
  await breakdownInput.fill("50");
  await expect(breakdownInput, "typing into the Breakdown % input must actually set its value").toHaveValue("50");
});
