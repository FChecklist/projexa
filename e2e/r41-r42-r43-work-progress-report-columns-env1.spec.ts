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
//
// ROOT-CAUSED 2026-09-13 (env1 CI fix pass): the real CI failure was NOT a
// wrong computed value -- it was `rootLink`'s own visibility wait timing out
// at 30s because this shared project's real, accumulated scale (240 BOQs at
// investigation time, confirmed via the Supabase MCP -- every env1 CI run
// ever executed creates more and nothing cleans them up) combined with this
// same run's own measured real upstream latency (compliance-tracker run
// 34758516701 / job 103727532493: 4.5s average, 29.5s tail across 174
// samples) to exceed hardcoded 30s waits inside a test whose OWN
// test.setTimeout(150_000) already anticipated needing far more headroom
// than that. Widened the two explicit waits inside assertScopeRow()
// accordingly -- see their own inline comments. This is a timing fix, not a
// logic fix: the explicit boqId selection this spec already does (the
// boqSelector block) is the correct, existing defense against the SEPARATE
// "which BOQ is latest" ambiguity r33-category-rollup-excludes-subtasks-
// env1.spec.ts's own header documents hitting harder (that spec has no
// selector to fall back on) -- this spec does not need r33's version-bump
// workaround because it never depends on the ambiguous auto-pick succeeding.
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
  // Set by the CEO test right after creation, read by assertScopeRow's own
  // diagnostic API cross-check below -- see its own comment for why.
  let createdBoqId: string | undefined;

  test.describe("CEO creates the real setup and sees the real computed columns", () => {
    test.use({ storageState: "playwright/.auth/ceo.json" });

    test("R-41/R-42/R-43 (CEO): Previous/Current/Total and Balance columns compute correctly from real progress entries", async ({ page }) => {
      // Real setup (BOQ + activity + 2 entries) plus TWO full real report
      // loads (Total mode, then Balance mode) -- comfortably over the
      // config's default 75s when the real report run is slow (R67 E-28
      // documents up to a real 30s server-side deadline on this exact route).
      //
      // WIDENED 2026-09-13 (env1 CI fix pass, second round): this test still
      // timed out at 150_000 total (compliance-tracker run 34760945921 /
      // job 103734029724) even after the two explicit waits inside
      // assertScopeRow() were each widened to 90s -- GET /api/work-progress/
      // report fans out up to 5 real upstream calls (scope, activities,
      // progress, roster, then attendance sequentially after), and this same
      // run's own earlier evidence measured a single such call's real
      // `upstreamMs` reaching a 29.5s tail -- a bad-luck combination across
      // that many calls, on top of this shared project's own growing real
      // BOQ count, can plausibly exceed even a 90s single-wait budget. Raised
      // the overall ceiling so the individual waits (also raised, see
      // assertScopeRow()) have real room rather than being capped by this
      // number first.
      test.setTimeout(240_000);

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
      createdBoqId = boqId;

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
        // WIDENED 2026-09-13 (env1 CI fix pass, then widened AGAIN the same
        // day after the first pass -- 90s -- still wasn't enough, see the
        // rootLink comment below for the second run's own evidence): this
        // project ("Meridian Heights", PROJECT_ID above) is shared by every
        // env1 spec in this suite and accumulates real, never-cleaned-up
        // BOQs across every CI run -- confirmed live via the Supabase MCP:
        // 240 real rows for this exact project_id at investigation time (and
        // growing every run, including this spec's own and its siblings').
        // GET /api/work-progress/report fans out up to 5 real upstream calls
        // to compliance-tracker (scope -- listing every one of that
        // project's BOQs' own line items --, activities, progress entries,
        // roster, then attendance sequentially after), and this suite's own
        // structured server logs have measured real per-call `upstreamMs`
        // averaging 4.5s with a 29.5s tail -- a bad-luck stack of several
        // such calls can plausibly exceed even a generous single-wait
        // budget, well before this spec's own real Third-column/report-
        // render work even starts.
        // FIXED 2026-09-13 (env1 CI fix pass, third round): the previous
        // `Promise.all([waitForResponse(...), click sequence])` approach
        // still failed deterministically at the 120s ceiling on
        // compliance-tracker run 34760945921 / job 103738088094, with
        // `rootLink` reporting "element(s) not found" rather than merely
        // slow -- a further timeout widen would not have fixed a real logic
        // gap. `waitForResponse`'s predicate only matches the URL/method,
        // not WHICH request -- if any earlier /api/work-progress/report GET
        // (e.g. the page's own initial auto-pick load) resolves after this
        // listener is registered, `Promise.all` can resolve on THAT
        // response instead of the one this click actually triggers, letting
        // the code race ahead to check `rootLink` against stale, still-
        // wrong-BOQ state that never catches up. Replaced with a direct,
        // state-based wait on the real rendered caption itself
        // (`report?.boqTitle` from the server, reportCaption() in
        // work-progress-report-params.ts) actually showing this spec's own
        // BOQ title -- unambiguous proof the correct report has loaded,
        // independent of which network response happened to resolve first.
        await boqSelector.click();
        await page.getByRole("option", { name: new RegExp(escapeRegExp(BOQ_TITLE)) }).click();
        await expect(
          page.getByTestId("wpr-caption"),
          "the real caption must reflect this spec's own selected BOQ before its rows are read"
        ).toContainText(BOQ_TITLE, { timeout: 120_000 });
      }
    }

    // DIAGNOSTIC CROSS-CHECK, added 2026-09-13 (env1 CI fix pass, fourth
    // round): the previous two fixes (a race-prone waitForResponse, then a
    // state-based caption wait) each independently ELIMINATED a real
    // candidate cause without fixing the actual failure -- compliance-
    // tracker run 34763964774 / job 103742046491 still reported `rootLink`
    // "element(s) not found" at the full 120s ceiling, with the caption
    // wait immediately above it having already succeeded (no separate error
    // from that line), proving the correct BOQ's report genuinely loaded.
    // Direct DB verification via the Supabase MCP (pcrjmlpuqsbocqfwoxod)
    // confirmed the root+sub lines for this exact run's own BOQ were
    // genuinely persisted with their real item codes -- ruling out "never
    // saved". So the remaining live question is DATA (does the report API's
    // own JSON response even contain this row) vs RENDER (rows.map()'s own
    // `r.code ? <Link data-testid="scope-code-link"> : "—"`,
    // WorkProgressReportClient.tsx -- an empty/falsy `code` would render the
    // row with NO link at all, which is indistinguishable from "row
    // missing" to a testid-based locator). Rather than guess a third time,
    // this makes the real API call the UI itself makes (same query params
    // runReport() sends) and asserts directly on the JSON -- if this fails,
    // the message below names the row array's real length and every code in
    // it, turning the next CI run's failure text into a definitive answer
    // instead of another "not found".
    if (createdBoqId) {
      const reportRes = await page.request.get(
        `/api/work-progress/report?projectId=${PROJECT_ID}&from=${FROM}&to=${TO}&boqId=${createdBoqId}`
      );
      expect(reportRes.ok(), "the real report API itself must succeed for this spec's own BOQ id").toBe(true);
      const reportBody: { rows?: Array<{ code?: string; lineItemId?: string; description?: string }> } = await reportRes.json();
      const apiRows = reportBody.rows ?? [];
      const apiRootRow = apiRows.find((r) => r.code === ROOT_CODE);
      expect(
        apiRootRow,
        `the report API's own rows[] must contain a row whose code is exactly "${ROOT_CODE}" -- got ${apiRows.length} row(s) with codes [${apiRows.map((r) => JSON.stringify(r.code)).join(", ")}]`
      ).toBeTruthy();
    }

    const rootLink = page.getByTestId("scope-code-link").filter({ hasText: ROOT_CODE });
    // WIDENED 2026-09-13 (env1 CI fix pass, same reasoning as the
    // waitForResponse widen just above -- TWICE the same day): the first
    // widening pass (30s -> 90s) was confirmed still insufficient by a real,
    // subsequent Env-1 CI run (compliance-tracker run 34760945921 / job
    // 103734029724) -- this exact assertion timed out again, still not on a
    // missing/wrong row, on a run where this shared project's real BOQ count
    // had grown even further (this spec's own sibling r33's fix now also
    // creates 1-2 extra revisions per run). Raised to 120s, with
    // test.setTimeout raised to 240_000 alongside it so this explicit
    // `{ timeout }` has real room inside the test's own overall ceiling
    // rather than being capped by it first.
    await expect(rootLink, "this spec's own real root line must appear in the real Scope-wise table").toBeVisible({ timeout: 120_000 });
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
