import { test, expect } from "@playwright/test";

// R-21 (Revisions): "Revision variation vs prior shown" (ScopeClient.tsx
// Compare dialog + /api/scope/[id]/compare) AND R-24 (Revisions):
// "Percentage-only change detected as variation" (diffLineItems
// breakdownPercentageChange). ONE spec for both, deliberately: they are the
// SAME real feature (the compare/diff between two real revisions) exercised
// with one real setup, not two -- splitting them would need to fabricate a
// second, near-identical revision pair just to give each id its own file.
//
// UNLIKE R-22/R-23/R-C13, these are NOT refusal/guard requirements -- there
// is nothing to block here. Both are about a real computed DIFFERENCE being
// shown correctly: R-21 that a real total variation amount appears, R-24
// that a line whose ONLY change is breakdownPercentage (quantity and rate
// both unchanged) is still reported as changed, not silently dropped from
// the diff because "nothing that matters to the total changed". Confirmed
// directly in source (ScopeCompareClient.tsx:28-34): changedFields only
// gets 'breakdownPercentage' pushed when breakdownPercentageChange !== 0,
// independent of quantity/rate -- this spec exercises exactly that branch
// through a real revision, not a hand-built diffLineItems() input.
//
// EXIT CONDITIONS:
//  1. Real user action: this spec creates its own real parent BOQ (v1) and a
//     real revision (v2) via real authenticated API calls -- one line's
//     quantity changes (a real, ordinary variation) and a SEPARATE line's
//     breakdownPercentage changes with quantity/rate held exactly equal
//     (the percentage-only case) -- then reads the real compare result the
//     same way a user opening Compare would.
//  2. Asserts the REAL computed values: a real non-zero total variation
//     (R-21), and the percentage-only line correctly flagged with
//     quantityChange=0, rateChange=0, breakdownPercentageChange!=0 (R-24) --
//     not a hand-built input to the diff function.
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION. Same RAM/CI blocker as
//     the guard-refusal specs in this batch (0.62GB free at write time, D72,
//     no Env-1 CI job yet). Plant/revert procedure: in diffLineItems()
//     (construction-boq-service.ts, cited by R-24's own file_path), comment
//     out the `breakdownPercentageChange` term from whichever condition
//     pushes 'breakdownPercentage' into changedFields (ScopeCompareClient.tsx
//     line 33's source condition lives in the diff itself, not the UI --
//     the UI only relays what compareBoq() returns) -- confirm this spec's
//     R-24 assertion goes red (changedFields no longer contains
//     'breakdownPercentage' for a qty/rate-identical line), then revert and
//     confirm green again.
//  4. Runs against Env-1 -- blocked from actually running until the CI job
//     exists, same as condition 3.
test.use({ storageState: "playwright/.auth/ceo.json" });

const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-21 / R-24: a real revision's total variation and a percentage-only change both show correctly", async ({ page }) => {
  const v1Title = `R-21-R24 env1 spec v1 ${Date.now()}`;
  const v1Res = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: v1Title,
      lineItems: [
        { itemCode: "R21R24-QTY", description: "R-21/R-24 spec: ordinary quantity variation line", unit: "sqm", quantity: 100, rate: 10 },
        { itemCode: "R21R24-ROOT", description: "R-21/R-24 spec: parent for the percentage-only line", unit: "sqm", quantity: 50, rate: 20 },
        { itemCode: "R21R24-PCT", description: "R-21/R-24 spec: percentage-only change line", unit: "sqm", quantity: 10, rate: 5, parentItemCode: "R21R24-ROOT", breakdownPercentage: 30 },
      ],
    },
  });
  expect(v1Res.ok(), "v1 BOQ creation must succeed for this spec's own setup").toBe(true);
  const v1 = await v1Res.json();

  // The real revision: R21R24-QTY's quantity genuinely changes (a real
  // variation for R-21); R21R24-PCT's quantity and rate are IDENTICAL to v1,
  // only its breakdownPercentage moves (30 -> 50) -- the percentage-only case
  // R-24 is about. R21R24-ROOT is passed through unchanged.
  const v2Res = await page.request.post(`/api/scope/${v1.id}/revisions`, {
    data: {
      title: `R-21-R24 env1 spec v2 ${Date.now()}`,
      lineItems: [
        { itemCode: "R21R24-QTY", description: "R-21/R-24 spec: ordinary quantity variation line", unit: "sqm", quantity: 140, rate: 10 },
        { itemCode: "R21R24-ROOT", description: "R-21/R-24 spec: parent for the percentage-only line", unit: "sqm", quantity: 50, rate: 20 },
        { itemCode: "R21R24-PCT", description: "R-21/R-24 spec: percentage-only change line", unit: "sqm", quantity: 10, rate: 5, parentItemCode: "R21R24-ROOT", breakdownPercentage: 50 },
      ],
    },
  });
  expect(v2Res.ok(), "v2 revision creation must succeed for this spec's own setup (no scope reduction here, only increases)").toBe(true);
  const v2 = await v2Res.json();

  // Real authenticated read of the real compare result -- the same request
  // the Compare button/page issues.
  const compareRes = await page.request.get(`/api/scope/${v2.id}/compare`);
  expect(compareRes.ok(), "the real compare endpoint must succeed for a real revision pair").toBe(true);
  const cmp = await compareRes.json();

  // R-21: a real, non-zero total variation is present.
  expect(typeof cmp.totalVariation, "totalVariation must be a real number").toBe("number");
  expect(cmp.totalVariation, "the quantity change on R21R24-QTY must produce a real non-zero variation").not.toBe(0);

  // R-24: the percentage-only line is reported as changed, with quantity and
  // rate genuinely unchanged and breakdownPercentage genuinely changed --
  // read from the real diff, not asserted from a hand-built input.
  const changedRows: Array<{ key?: string; previous?: { itemCode?: string }; current?: { itemCode?: string }; quantityChange: number; rateChange: number; breakdownPercentageChange: number }> = cmp.changed ?? [];
  const pctRow = changedRows.find(
    (r) => r.previous?.itemCode === "R21R24-PCT" || r.current?.itemCode === "R21R24-PCT" || r.key === "R21R24-PCT"
  );
  expect(pctRow, "the percentage-only line must appear in the real changed[] diff, not be silently dropped").toBeTruthy();
  expect(pctRow!.quantityChange, "the percentage-only line's real quantity must be unchanged").toBe(0);
  expect(pctRow!.rateChange, "the percentage-only line's real rate must be unchanged").toBe(0);
  expect(pctRow!.breakdownPercentageChange, "the percentage-only line's real breakdownPercentage must have actually changed").not.toBe(0);

  // Cross-check against the real rendered page too, not only the API.
  await page.goto(`/scope/${v2.id}/compare`, { waitUntil: "networkidle" });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the real compare page must show a Total variation figure").toMatch(/total variation/i);
});
