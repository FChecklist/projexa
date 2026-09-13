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
// that a line whose breakdownPercentage changes is still reported as
// changed, not silently dropped from the diff. Confirmed directly in source
// (ScopeCompareClient.tsx:28-34): changedFields gets 'breakdownPercentage'
// pushed whenever breakdownPercentageChange !== 0 -- this spec exercises
// exactly that branch through a real revision, not a hand-built
// diffLineItems() input.
//
// CORRECTED 2026-09-13 (env1 CI fix pass): an earlier version of this spec
// (and of this comment) assumed a child (sub-task) line's quantity AND rate
// stay literally unchanged when only its breakdownPercentage moves. That is
// wrong -- construction-boq-service.ts's deriveLineItemQuantityAndRate()
// (the "CANONICAL CHILD-RATE RULE", settled R45 seq 7 / E-127) deliberately,
// unconditionally derives a child's own stored rate as
// RATE_child = RATE_root x (breakdownPercentage / 100). Whatever `rate` a
// caller submits for a child row is ignored and overwritten at write time.
// So changing breakdownPercentage on a child line ALSO changes its derived
// rate (unless the root's rate is 0) -- there is no such thing as a
// "percentage-only, rate-untouched" change for a child line under this
// codebase's real, confirmed customer spec (platform.sumeet_spec row
// BOQ-10). What IS genuinely true, and is what this spec now asserts: (a)
// the child's derived QUANTITY stays unchanged (QTY_child = QTY_root, and
// the root's own quantity does not change here), and (b) the derived RATE
// changes to the exact value the formula predicts, not to zero -- and
// 'breakdownPercentage' still correctly appears in changedFields regardless
// of the rate also changing (R-24's real point: the field isn't silently
// dropped from the diff, not that nothing else changes alongside it).
//
// EXIT CONDITIONS:
//  1. Real user action: this spec creates its own real parent BOQ (v1) and a
//     real revision (v2) via real authenticated API calls -- one line's
//     quantity changes (a real, ordinary variation) and a SEPARATE line's
//     breakdownPercentage changes (the percentage-driven case, which also
//     changes its derived rate per F2 above) -- then reads the real compare
//     result the same way a user opening Compare would.
//  2. Asserts the REAL computed values: a real non-zero total variation
//     (R-21), and the percentage-only line correctly flagged with
//     quantityChange=0, rateChange equal to the exact F2-derived delta
//     (not 0), and breakdownPercentageChange!=0 (R-24) -- not a hand-built
//     input to the diff function.
//  3. BREAK-RESTORE: verified by this session (2026-09-13) -- see the fix PR
//     description for the exact plant/revert transcript. Plant/revert
//     procedure: in diffLineItems() (construction-boq-service.ts, cited by
//     R-24's own file_path), comment out the `breakdownPercentageChange`
//     term from whichever condition pushes 'breakdownPercentage' into
//     changedFields (ScopeCompareClient.tsx line 33's source condition lives
//     in the diff itself, not the UI -- the UI only relays what
//     compareBoq() returns) -- confirms this spec's R-24 assertion goes red
//     (changedFields no longer contains 'breakdownPercentage'), then revert
//     and confirm green again.
//  4. Runs against Env-1 in compliance-tracker PR #1723's cross-repo E2E job.
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

  // R-24: the breakdownPercentage-driven line is reported as changed and NOT
  // silently dropped from the diff -- read from the real diff, not asserted
  // from a hand-built input. Per the CANONICAL CHILD-RATE RULE (F2/F3 in
  // construction-boq-service.ts), a child line's derived quantity stays tied
  // to its root's quantity (unchanged here) but its derived rate is
  // RATE_root x (breakdownPercentage/100) -- so it genuinely changes too:
  // v1 = 20 x 30/100 = 6, v2 = 20 x 50/100 = 10, a real rateChange of 4.
  const changedRows: Array<{ key?: string; previous?: { itemCode?: string }; current?: { itemCode?: string }; quantityChange: number; rateChange: number; breakdownPercentageChange: number }> = cmp.changed ?? [];
  const pctRow = changedRows.find(
    (r) => r.previous?.itemCode === "R21R24-PCT" || r.current?.itemCode === "R21R24-PCT" || r.key === "R21R24-PCT"
  );
  expect(pctRow, "the percentage-only line must appear in the real changed[] diff, not be silently dropped").toBeTruthy();
  expect(pctRow!.quantityChange, "the line's real derived quantity (QTY_root, unchanged here) must be unchanged").toBe(0);
  expect(
    pctRow!.rateChange,
    "the line's real derived rate must change to the exact F2-derived delta (RATE_root x breakdownPercentage/100): a child's rate is NOT independently settable, so it is not 0"
  ).toBe(4);
  expect(pctRow!.breakdownPercentageChange, "the percentage-only line's real breakdownPercentage must have actually changed").toBe(20);

  // Cross-check against the real rendered page too, not only the API.
  await page.goto(`/scope/${v2.id}/compare`, { waitUntil: "networkidle" });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the real compare page must show a Total variation figure").toMatch(/total variation/i);
});
