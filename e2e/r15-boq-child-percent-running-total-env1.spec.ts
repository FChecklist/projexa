import { test, expect } from "@playwright/test";

// R-15 (Weighted Sub-Tasks): "Running total of child percentages shown per
// parent". Recorded closure_state=BLOCKED, same shared root cause as R-30/
// R-31 (F-2026-0910-PM-068). BUILT IN PROJEXA, corrected by chat 22 Aug
// (E-112) to point at ScopeObjectClient.tsx (the View dialog), not
// ScopeClient.tsx.
//
// Grounded directly in source: ScopeObjectClient.tsx computes
// `childSum = childPercentSum(...)` for each NON-sub (parent) row and, when
// non-null, renders `(children: {childSum}%)` beside that parent's own
// description. The function deliberately does NOT warn or auto-normalise a
// non-100 total (own comment, ScopeClient.tsx/childPercentSum) -- so a real
// parent whose children sum to 75%, not 100%, showing "(children: 75%)" with
// no warning IS the correct, in-spec behaviour, not a bug this spec should
// flag.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as R-30/R-31/R-60.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Same real, live BOQ as R-30/R-31's specs: R81-ROOT's two children
// (R81-SUB-A=40%, R81-SUB-B=35%) sum to 75%, confirmed live 2026-09-10
// against compliance.construction_boq_line_items.
const BOQ_ID = "uaxct0zlk2mrcn1jxswsqw1a";

test("R-15: a parent line shows its children's running percentage total, against a real BOQ", async ({ page }) => {
  await page.goto(`/scope/${BOQ_ID}`, { waitUntil: "networkidle" });

  // D58 falsifiability note (manual break-restore, not yet run -- see header):
  // planting a defect means temporarily hardcoding childSum to null (or to a
  // wrong number) in ScopeObjectClient.tsx, confirming this assertion goes
  // red on the wrong/missing text, then reverting.
  const bodyText = await page.locator("body").innerText();
  expect(
    bodyText,
    "the root line must show its own real children total (40+35=75%), not 100% and not blank"
  ).toMatch(/\(children:\s*75%\)/);
});
