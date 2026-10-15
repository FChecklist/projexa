import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, serverCall } from "./support/real-backend";

// SUMEET 111, checklist 4.2 (R-41 Previous/Current/Total %, R-42 the same for Qty, R-43 the same for Amount, R-45 parent % = cumulative amount / total amount),
// as a USER on the deployed site: a fresh browser profile signs in as a documented E2E person, opens the Work Progress report (Report tab, run), and reads the
// figures the way a person would: under each band the Total column must equal Previous + Current, and on a row that shows a percentage the percentage must
// equal the cumulative amount over the total amount. Same method and config as live-online-reports-users.spec.ts (playwright.live-offline-users.config.ts).
// R-44 (parent cumulative qty = sum of child cumulative qty x breakdown %) needs the breakdown % which the table does not show: it is covered by the unit
// and Env-1 specs (r41-r42-r43-work-progress-report-columns-env1.spec.ts), not claimed here.
test.setTimeout(600_000);

const VILLA = "Villa Fit-Out (Manual Demo)";
let A: { context: BrowserContext; page: Page };
let V = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  A = await openLaptop(browser, "finance");
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  V = manifest.projects.find((x) => x.name === VILLA)!.id;
  expect(V, "the E2E organisation has the Villa project").toBeTruthy();
});
test.afterAll(async () => {
  await A?.context.close();
});

/** "AED1,234.50" / "45.2%" / "12 m2" -> a number; an empty cell or a dash -> null. */
function num(s: string): number | null {
  const t = s.replace(/,/g, "");
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

test("4.2 R-41..R-45 on the Work Progress report: Total = Previous + Current under each band, and the parent % = cumulative amount / total amount", async () => {
  const page = A.page;
  await page.goto(`/work-progress?projectId=${V}&tab=report&px-server=1`);
  const run = page.getByTestId("work-progress-report-run");
  await expect(run).toBeVisible({ timeout: 120_000 });
  // an all-time window so there is something to read: the "all" preset if offered, else the run as it stands
  const all = page.getByTestId("wpr-period-all");
  if (await all.isVisible().catch(() => false)) await all.click();
  if (await run.isEnabled().catch(() => false)) await run.click();
  const rows = page.locator("tr:has([data-testid='amt-total'])");
  await expect(rows.first(), "the report shows at least one scope row").toBeVisible({ timeout: 180_000 });
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);

  let checkedBands = 0;
  let checkedPct = 0;
  const problems: string[] = [];
  const mode = (await page.getByTestId("third-column-mode").innerText().catch(() => "")).toLowerCase();
  const thirdIsTotal = !mode.includes("balance");
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const cell = async (id: string) => num(await row.getByTestId(id).innerText());
    const code = (await row.locator("td").nth(2).innerText()).trim() || `row ${i + 1}`;
    for (const band of ["qty", "amt"] as const) {
      const prev = await cell(`${band}-prev`);
      const cur = await cell(`${band}-current`);
      const third = await cell(`${band}-third`);
      if (thirdIsTotal && prev !== null && cur !== null && third !== null) {
        checkedBands++;
        if (Math.abs(prev + cur - third) > 0.011 * Math.max(1, Math.abs(third))) problems.push(`${code} ${band}: previous ${prev} + current ${cur} is not total ${third}`);
      }
    }
    const pPrev = await cell("pct-prev");
    const pCur = await cell("pct-current");
    const pThird = await cell("pct-third");
    if (thirdIsTotal && pPrev !== null && pCur !== null && pThird !== null) {
      checkedBands++;
      if (Math.abs(pPrev + pCur - pThird) > 0.15) problems.push(`${code} percent: previous ${pPrev} + current ${pCur} is not total ${pThird}`);
    }
    const amtTotal = await cell("amt-total");
    const amtThird = await cell("amt-third");
    if (thirdIsTotal && pThird !== null && amtTotal && amtThird !== null) {
      checkedPct++;
      const expected = (amtThird / amtTotal) * 100;
      if (Math.abs(expected - pThird) > 0.15) problems.push(`${code}: percent ${pThird} but cumulative amount ${amtThird} over total ${amtTotal} is ${expected.toFixed(2)}`);
    }
  }
  test.info().annotations.push({ type: "rows-read", description: `${n} rows; ${checkedBands} band checks; ${checkedPct} percent-vs-amount checks; third column = ${thirdIsTotal ? "Total" : "Balance"}` });
  expect(problems, problems.join(" | ")).toEqual([]);
  expect(checkedBands, "at least one band was actually compared (the check is not vacuous)").toBeGreaterThan(0);
});

test("4.2 offline: the Work Progress report says in words that it needs a connection, instead of showing figures it does not have", async () => {
  const page = A.page;
  // the laptop opens its own Reports screen first, while connected, so the shell is on the laptop; then the network is cut and the same screen is opened again
  await page.goto(`/local/reports?projectId=${V}`);
  await page.waitForTimeout(8_000);
  await A.context.setOffline(true);
  try {
    await page.goto(`/local/reports?projectId=${V}`);
    await page.waitForTimeout(5_000);
    const text = (await page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.innerText ?? "")).replace(/\s+/g, " ");
    expect(text.length, "the offline Reports screen has content").toBeGreaterThan(20);
    const at = text.toLowerCase().indexOf("work progress");
    expect(at, "the Work Progress report is listed on the offline screen").toBeGreaterThanOrEqual(0);
    const around = text.slice(Math.max(0, at - 40), at + 400).toLowerCase();
    test.info().annotations.push({ type: "offline-work-progress-text", description: around });
    expect(around, "next to Work Progress it says, in words, that it needs a connection or opens on its own screen").toMatch(/connect|online|server|internet|own screen|open work progress/);
  } finally {
    await A.context.setOffline(false);
  }
});
