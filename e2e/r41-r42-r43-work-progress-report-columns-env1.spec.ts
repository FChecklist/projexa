import { test, expect, type Page } from "@playwright/test";

// R-41 "Previous % / Current % / Total % columns"
// R-42 "Previous Qty / Current Qty / Total Qty columns"
// R-43 "Cum Amt / Current Amt / Balance Amt columns"
// (platform.sumeet_requirements @ pcrjmlpuqsbocqfwoxod, Work Progress module).
// Recorded file_path hint: src/components/WorkProgressReportClient.tsx.
//
// ALL THREE are the SAME real screen and the SAME real table: the Work
// Progress Report's Scope-wise tab. Confirmed by direct read of
// WorkProgressReportClient.tsx's ScopeTable -- there are not three
// separately-worded headers, there are THREE BANDS ("Percent" / "Quantity"
// / "Amount", one TableHead each, colSpan=3 -- lines 291-293) and under
// every band the SAME three sub-columns, "Previous" / "Current" /
// "Total"-or-"Balance" (lines 296-298), rendered per row with real
// data-testids "pct-prev"/"pct-current"/"pct-third",
// "qty-prev"/"qty-current"/"qty-third", "amt-prev"/"amt-current"/"amt-third"
// (lines 322-334). So the requirement text is satisfied by the (band, real
// sub-column, real computed number) TRIPLE, not by literal strings
// "Previous %"/"Cum Amt" appearing verbatim anywhere on screen -- neither
// does. In particular R-43's own wording, "Cum Amt", does NOT occur anywhere
// in this app (grepped); the real first sub-column is "Previous" (same word
// R-41/R-42 use), and the real third sub-column is "Total" in the default
// Third-column mode or "Balance" once the reader flips the
// "third-column-mode" control (ThirdColumnMode, lines 271/296-298) -- this
// spec exercises BOTH real wordings of that third column in the CEO run.
//
// A weaker version of this requirement already exists in this suite
// (r81-d603-work-progress.spec.ts): it confirms the band + sub-column
// headers are PRESENT over at least one real row. This spec is the stronger
// claim the task asked for -- that the numbers UNDER those headers are the
// mathematically correct ones for a real, freshly-recorded set of progress
// entries, computed independently here from the same formulas the report
// itself uses (computeLineItemProgress, work-progress-report.ts:262-350;
// applyWeightedParentRollup, work-progress-report.ts:436-480) rather than
// merely asserting the columns exist -- a column full of wrong numbers would
// still "exist".
//
// SETUP, real end to end: a real BOQ (POST /api/scope) with a root line and
// ONE real weighted sub-task (same convention as
// r33-category-rollup-excludes-subtasks-env1.spec.ts's own setup, and the
// same real project id every env1 spec in this batch uses), then two real
// progress entries (POST /api/work-progress) recorded against the
// SUB-TASK's own line -- one dated strictly before the report's `from`
// (-> Previous), one dated inside [from, to] (-> Current), both
// entryBasis:"DELTA" (additive, sumQtyInRange, work-progress-report.ts:
// 104-107). Recording against the CHILD rather than the root is deliberate:
// it is what actually exercises applyWeightedParentRollup's real weighted
// roll-up math for the ROOT row (WPR-06's parent-only percentages, R12
// point 10) -- the harder, more real path this report's Percent/Qty/Amt
// bands depend on -- rather than the trivial direct-entry case.
//
// PAYLOAD AMBIGUITY, flagged honestly rather than guessed away: this repo
// contains two different real examples of the POST /api/work-progress body.
// WorkProgressFormClient.tsx's currentPayload() (lines 304-315) sends
// {projectId, activityId, boqLineItemId, entryDate, quantityDone,
// percentComplete, entryBasis, remarks} -- no boqId -- and
// work-progress-form-fields.ts's requiredProgressFields() lists activityId
// as unconditionally required. But r22-boq-revision-remove-progressed-line-
// blocked-env1.spec.ts (lines 68-78), a real spec already in this suite,
// posts {projectId, boqId, boqLineItemId, entryDate, quantityDone,
// percentComplete, entryBasis} -- WITH boqId, WITHOUT activityId -- and
// asserts success. Which field(s) the live VERIDIAN service actually
// requires could not be confirmed from source alone (the service itself
// lives outside this repo). This spec sends BOTH activityId (a real one it
// creates via POST /api/work-progress/activities first) AND boqId, so it
// cannot fail on whichever the real server enforces.
//
// TWO ROLES, per this task's own brief. CEO (owner) creates the real BOQ and
// entries and reads the resulting report. Finance (Deepak Joshi,
// PROJEXA-local role "member" -- e2e/users.ts:28-33) deliberately does NOT
// repeat that setup: src/lib/authz/api-write-policy.ts gates POST /scope at
// "PM_OR_ABOVE" (line 312) and POST /work-progress + /work-progress/
// activities at "FIELD" (lines 379/386) -- roles.ts:39-46 defines both
// groups as {owner, admin, pm[, site_engineer]}, which excludes "member".
// Finance's real membership role genuinely cannot write either of those, so
// its test is the "reduced read-only version" the brief asked for: it only
// navigates to the real report the CEO's real writes already produced and
// re-reads the same real numbers.
//
// EXIT CONDITIONS:
//  1. Real user action: real BOQ + real weighted sub-task + two real
//     progress entries via real authenticated API calls (page.request, the
//     same session cookies the browser itself would send), then the real
//     rendered WPR Scope-wise table read the way a user reading the report
//     would -- including using the real BOQ selector and the real
//     Third-column toggle, not just re-reading the API JSON.
//  2. Asserts the REAL computed Previous/Current/Total(or Balance) numbers
//     for Percent, Quantity and Amount against numbers this spec computes
//     itself from the real API responses (root line's own real amount/
//     quantity/rate) and the real formulas cited above -- not hand-typed
//     constants and not merely "the cell is non-empty".
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION. Same RAM/CI blocker as
//     the rest of this batch (no Env-1 CI job at authoring time). Plant/
//     revert procedure: in applyWeightedParentRollup() (work-progress-
//     report.ts:436-480), change `cumAmt`'s weighting term from
//     `row.rate * (breakdownPctOf(c) / 100)` to `row.rate` alone (drop the
//     breakdown-percentage weighting) -- expect this spec's Amt/Percent
//     assertions to go red (root row's Amt would report double what a 50%
//     breakdown should roll up), then revert and confirm green again.
//  4. Runs against Env-1 (http://localhost:3100, real Supabase-backed
//     backend) -- not yet executed by this session; drafted for independent
//     review and run.
test.describe.serial("R-41/R-42/R-43: Work Progress Report Previous/Current/Total(-or-Balance) columns", () => {
  const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04"; // Meridian Heights, same real project every env1 spec in this batch uses
  const RUN_TAG = Date.now();
  const BOQ_TITLE = `R41R42R43 env1 spec ${RUN_TAG}`;
  const CATEGORY = `R41R42R43 Spec Category ${RUN_TAG}`;
  const ROOT_CODE = `R41-ROOT-${RUN_TAG}`;
  const SUB_CODE = `R41-SUB-${RUN_TAG}`;

  const ROOT_QTY = 100;
  const ROOT_RATE = 1000;
  const SUB_QTY = 20; // the sub-task's own contracted quantity -- NOT used by the weighted roll-up formula, only by its own (unasserted) row
  const SUB_RATE = 1000;
  const BREAKDOWN_PCT = 50;

  // A real 6-day window ending "today" (2026-09-11), with one entry strictly
  // before it and one strictly inside it -- so Previous and Current are
  // genuinely different, non-zero, distinguishable buckets.
  const TO = "2026-09-11";
  const FROM = "2026-09-06";
  const PREV_DATE = "2026-09-03"; // < FROM -> Previous
  const CURRENT_DATE = "2026-09-09"; // in [FROM, TO] -> Current
  const PREV_QTY_DONE = 8;
  const CURRENT_QTY_DONE = 6; // 8+6=14 of 20 (70%) -- deliberately short of the sub-task's full contracted quantity, to stay clear of any "fully complete" edge behaviour

  type Expected = {
    qtyPrev: number; qtyCurrent: number; qtyTotal: number; qtyBalance: number;
    amtPrev: number; amtCurrent: number; amtTotal: number; amtBalance: number;
    pctPrev: number; pctCurrent: number; pctTotal: number; pctBalance: number;
  };
  let expected: Expected;

  test.describe("CEO creates the real setup and sees the real computed columns", () => {
    test.use({ storageState: "playwright/.auth/ceo.json" });

    test("R-41/R-42/R-43 (CEO): Previous/Current/Total and Balance columns compute correctly from real progress entries", async ({ page }) => {
      // Real setup (BOQ + activity + 2 entries) plus TWO full real report
      // loads (Total mode, then Balance mode) -- comfortably over the
      // config's default 75s when the real report run is slow (R67 E-28
      // documents up to a real 30s server-side deadline on this exact route).
      test.setTimeout(150_000);

      // 1. Real BOQ: a root line + one real weighted sub-task.
      const createRes = await page.request.post("/api/scope", {
        data: {
          projectId: PROJECT_ID,
          title: BOQ_TITLE,
          lineItems: [
            { itemCode: ROOT_CODE, description: "R-41/42/43 spec: root line", unit: "sqm", quantity: ROOT_QTY, rate: ROOT_RATE, category: CATEGORY },
            { itemCode: SUB_CODE, description: "R-41/42/43 spec: weighted sub-task", unit: "sqm", quantity: SUB_QTY, rate: SUB_RATE, parentItemCode: ROOT_CODE, breakdownPercentage: BREAKDOWN_PCT, category: CATEGORY },
          ],
        },
      });
      expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
      const created = await createRes.json();
      const boqId: string = created.id;
      expect(boqId, "the real BOQ id must come back from the create response").toBeTruthy();

      const lineItems = created.lineItems as Array<{ id: string; itemCode: string; amount: number | string; quantity: number | string; rate: number | string }>;
      const rootLine = lineItems.find((l) => l.itemCode === ROOT_CODE);
      const subLine = lineItems.find((l) => l.itemCode === SUB_CODE);
      expect(rootLine, "the real root line must come back from the create response").toBeTruthy();
      expect(subLine, "the real weighted sub-task line must come back from the create response").toBeTruthy();

      // Read the real stored figures rather than assuming quantity*rate --
      // same discipline r33's spec uses for the root line's real amount.
      const rootAmtTotal = Number(rootLine!.amount);
      const rootQtyTotal = Number(rootLine!.quantity);
      const rootRate = Number(rootLine!.rate);
      expect(rootAmtTotal, "the root line's real stored amount must be a positive number").toBeGreaterThan(0);
      expect(rootQtyTotal, "the root line's real stored quantity must be a positive number").toBeGreaterThan(0);
      expect(rootRate, "the root line's real stored rate must be a positive number").toBeGreaterThan(0);

      // 2. A real activity -- see the PAYLOAD AMBIGUITY note above for why
      // this spec creates and sends one even though a second real spec in
      // this suite succeeds without it.
      const activityRes = await page.request.post("/api/work-progress/activities", {
        data: { projectId: PROJECT_ID, name: `R41R42R43 spec activity ${RUN_TAG}` },
      });
      expect(activityRes.ok(), "activity creation must succeed for this spec's own setup").toBe(true);
      const activityBody = await activityRes.json();
      const activityId: string | undefined = activityBody.id ?? activityBody.activity?.id;
      expect(activityId, "the real activity id must come back from the create response").toBeTruthy();

      // 3. Two real progress entries against the SUB-TASK's own line.
      for (const entry of [
        { entryDate: PREV_DATE, quantityDone: PREV_QTY_DONE, percentComplete: (PREV_QTY_DONE / SUB_QTY) * 100 },
        { entryDate: CURRENT_DATE, quantityDone: CURRENT_QTY_DONE, percentComplete: (CURRENT_QTY_DONE / SUB_QTY) * 100 },
      ]) {
        const entryRes = await page.request.post("/api/work-progress", {
          data: {
            projectId: PROJECT_ID,
            boqId,
            boqLineItemId: subLine!.id,
            activityId,
            entryDate: entry.entryDate,
            quantityDone: entry.quantityDone,
            percentComplete: entry.percentComplete,
            entryBasis: "DELTA",
          },
        });
        expect(entryRes.ok(), `logging real progress on ${entry.entryDate} must succeed for this spec's own setup`).toBe(true);
      }

      // 4. The SAME formulas the report itself uses once a line has a
      // weighted child (applyWeightedParentRollup, work-progress-report.ts:
      // 450-467):
      //   cum qty = child qty * breakdownPercentage / 100
      //   cum amt = child qty * (PARENT's own rate * breakdownPercentage / 100)
      //   percent = cum amt / parent's own real amtTotal, rounded to 2dp
      //   balance = parent's own real total - cum (qty and amt alike)
      const w = BREAKDOWN_PCT / 100;
      const qtyPrev = PREV_QTY_DONE * w;
      const qtyCurrent = CURRENT_QTY_DONE * w;
      const qtyTotal = qtyPrev + qtyCurrent;
      const qtyBalance = rootQtyTotal - qtyTotal;
      const amtPrev = PREV_QTY_DONE * (rootRate * w);
      const amtCurrent = CURRENT_QTY_DONE * (rootRate * w);
      const amtTotal = amtPrev + amtCurrent;
      const amtBalance = rootAmtTotal - amtTotal;
      const pct = (a: number) => Math.round((a / rootAmtTotal) * 10000) / 100;
      expected = {
        qtyPrev, qtyCurrent, qtyTotal, qtyBalance,
        amtPrev, amtCurrent, amtTotal, amtBalance,
        pctPrev: pct(amtPrev), pctCurrent: pct(amtCurrent), pctTotal: pct(amtTotal), pctBalance: pct(amtBalance),
      };

      // 5. The real WPR screen -- explicit from/to so the auto-defaulted
      // "earliest entry" path (WorkProgressReportClient.tsx:659-706) never
      // runs, and both real wordings of the third column (Total, Balance).
      await assertScopeRow(page, "total");
      await assertScopeRow(page, "balance");
    });
  });

  test.describe("Finance (read-only) sees the same real computed columns", () => {
    test.use({ storageState: "playwright/.auth/finance.json" });

    test("R-41/R-42/R-43 (Finance, read-only): the same Previous/Current/Total columns are visible and correct", async ({ page }) => {
      // Reduced, read-only: no setup calls (Finance's real "member" role
      // cannot make them -- see header note), just the real report re-read
      // in the default "Total" third-column mode.
      await assertScopeRow(page, "total");
    });
  });

  /**
   * Navigates to the real WPR Scope-wise table, makes sure this spec's own
   * real BOQ is the one showing (via the real BOQ selector, same as a user
   * would), and checks the real ROOT row's real rendered Percent/Quantity/
   * Amount cells against `expected`.
   */
  async function assertScopeRow(page: Page, mode: "total" | "balance") {
    await page.goto(`/work-progress?projectId=${PROJECT_ID}&tab=report&from=${FROM}&to=${TO}&view=scope`);
    // KD-15 (per r81-d603-work-progress.spec.ts's own note): a cold route
    // compiles on first hit -- give the first paint real headroom.
    await page.getByTestId("wpr-caption").waitFor({ state: "visible", timeout: 45_000 });

    const boqSelector = page.getByTestId("boq-selector");
    if ((await boqSelector.count()) > 0) {
      const captionText = await page.getByTestId("wpr-caption").innerText();
      if (!captionText.includes(BOQ_TITLE)) {
        await Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/work-progress/report") && r.request().method() === "GET"),
          (async () => {
            await boqSelector.click();
            await page.getByRole("option", { name: new RegExp(escapeRegExp(BOQ_TITLE)) }).click();
          })(),
        ]);
      }
    }

    const rootLink = page.getByTestId("scope-code-link").filter({ hasText: ROOT_CODE });
    await expect(rootLink, "this spec's own real root line must appear in the real Scope-wise table").toBeVisible({ timeout: 30_000 });
    const rootRow = rootLink.locator("xpath=ancestor::tr[1]");

    if (mode === "balance") {
      await page.getByTestId("third-column-mode").click();
      await page.getByRole("option", { name: "Balance", exact: true }).click();
      await expect(page.getByTestId("third-column-mode"), "the Third-column control must really have switched to Balance before its cells are read").toContainText("Balance");
    }

    const pctPrev = parsePercent(await rootRow.getByTestId("pct-prev").innerText());
    const pctCurrent = parsePercent(await rootRow.getByTestId("pct-current").innerText());
    const pctThird = parsePercent(await rootRow.getByTestId("pct-third").innerText());

    const qtyPrev = parseQty(await rootRow.getByTestId("qty-prev").innerText());
    const qtyCurrent = parseQty(await rootRow.getByTestId("qty-current").innerText());
    const qtyThird = parseQty(await rootRow.getByTestId("qty-third").innerText());

    const amtPrev = parseMoney(await rootRow.getByTestId("amt-prev").innerText());
    const amtCurrent = parseMoney(await rootRow.getByTestId("amt-current").innerText());
    const amtThird = parseMoney(await rootRow.getByTestId("amt-third").innerText());

    const thirdLabel = mode === "balance" ? "Balance" : "Total";

    // R-41: Previous % / Current % / Total % -- the real "Percent" band's
    // three real sub-columns (WorkProgressReportClient.tsx:291/296-298/
    // 322-324), asserted against the real weighted-roll-up percentage.
    expect(pctPrev, "R-41 Previous %").toBeCloseTo(expected.pctPrev, 2);
    expect(pctCurrent, "R-41 Current %").toBeCloseTo(expected.pctCurrent, 2);
    expect(pctThird, `R-41 ${thirdLabel} %`).toBeCloseTo(mode === "balance" ? expected.pctBalance : expected.pctTotal, 2);

    // R-42: Previous Qty / Current Qty / Total Qty -- the real "Quantity"
    // band (lines 292/328-330).
    expect(qtyPrev, "R-42 Previous Qty").toBeCloseTo(expected.qtyPrev, 2);
    expect(qtyCurrent, "R-42 Current Qty").toBeCloseTo(expected.qtyCurrent, 2);
    expect(qtyThird, `R-42 ${thirdLabel} Qty`).toBeCloseTo(mode === "balance" ? expected.qtyBalance : expected.qtyTotal, 2);

    // R-43: "Cum Amt / Current Amt / Balance Amt" in the requirement's own
    // words -- the real "Amount" band (lines 293/332-334). The real first
    // sub-column reads "Previous", not "Cum"; the real third reads "Total"
    // or "Balance" depending on this same toggle -- both real wordings are
    // exercised across the two calls this spec makes (mode "total" then
    // "balance" in the CEO run).
    expect(amtPrev, "R-43 Previous Amt").toBeCloseTo(expected.amtPrev, 2);
    expect(amtCurrent, "R-43 Current Amt").toBeCloseTo(expected.amtCurrent, 2);
    expect(amtThird, `R-43 ${thirdLabel} Amt`).toBeCloseTo(mode === "balance" ? expected.amtBalance : expected.amtTotal, 2);
  }
});

function parsePercent(text: string): number {
  return Number(text.replace("%", "").trim());
}
function parseQty(text: string): number {
  return Number(text.replace(/,/g, "").trim());
}
function parseMoney(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
