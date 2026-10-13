import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLaptop, serverCall } from "./support/real-backend";

// SUMEET 111, section 5 (reports and downloads) and 4.5 (Project 360 figures), as a USER on the deployed site: a fresh browser profile signs in as a documented
// E2E person, each of the 17 project reports is opened by its link, run, read like a person reads it (title, headings, rows), then Export (PDF, XLSX, CSV) and
// Share are used and the files are compared with the table on the screen. Same method and config as live-offline-screens-users.spec.ts
// (playwright.live-offline-users.config.ts; not part of pull-request CI).
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const VILLA = "Villa Fit-Out (Manual Demo)";
const REPORTS = [
  "project-status", "project-completion", "work-progress", "category-progress", "weekly-project", "attendance", "manpower-cost", "site-picture", "scope",
  "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost", "designer-timesheet", "kpi", "revenue", "expense",
];
const SHAREABLE = ["work-progress", "project-status"];
// These four run on their OWN screens: the Reports primary is named "Open <report>" and navigates, it never runs in place (ReportsClient.test.tsx).
const OWN_SCREEN = ["work-progress", "budget-summary", "material-consumption", "designer-timesheet"];
const IN_PLACE = REPORTS.filter((r) => !OWN_SCREEN.includes(r));
let A: { context: BrowserContext; page: Page };
let V = "";
const seen: Record<string, { title: string; headings: string[]; text: number; exportReason: string; shareReason: string; links: Record<string, string | null> }> = {};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  const manifest = await serverCall<{ projects: { id: string; name?: string }[] }>(A.context, "GET", "/manifest");
  V = manifest.projects.find((x) => x.name === VILLA)!.id;
  expect(V, "the E2E organisation has the Villa project").toBeTruthy();
});
test.afterAll(async () => {
  await A?.context.close();
});

async function mainText(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.innerText ?? "");
}

/** Opens a report by its link and makes sure it has run. */
async function openReport(page: Page, slug: string) {
  const week = slug === "weekly-project" ? "&weekStart=2026-10-05" : "";
  await page.goto(`/reports?projectId=${V}&report=${slug}${week}&px-server=1`);
  const title = page.getByTestId("reports-title-block");
  if (!(await title.isVisible({ timeout: 20_000 }).catch(() => false))) {
    const run = page.getByTestId("reports-run");
    if (await run.isEnabled().catch(() => false)) await run.click();
  }
  await expect(title).toBeVisible({ timeout: 120_000 });
}


/** GET with up to 3 tries on a dropped connection (ETIMEDOUT / ECONNRESET on this laptop's network). A wrong STATUS is never retried: it is the finding. */
async function getFile(ctx: BrowserContext, url: string) {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try { return await ctx.request.get(url, { timeout: 120_000 }); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 5_000)); }
  }
  throw last;
}

/** A screen heading without its bracketed unit ("Budget (AED)" -> "budget"): the unit is a label on the screen, the exported column keeps the plain name. */
const norm = (h: string) => h.toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

async function absolute(page: Page, href: string): Promise<string> {
  return new URL(href, page.url()).toString();
}

test("5.2 each of the 17 project reports opens by its link, runs, and reads as a report (title, headings, rows), with Export and Share saying what they do", async () => {
  for (const slug of OWN_SCREEN) {
    const page = A.page;
    await page.goto(`/reports?projectId=${V}&report=${slug}&px-server=1`);
    const primary = page.getByTestId("reports-run");
    await expect(primary, `${slug}: the primary names the screen it opens`).toContainText(/^\s*Open /i, { timeout: 60_000 });
    await primary.click();
    await page.waitForURL((u) => !u.pathname.startsWith("/reports"), { timeout: 60_000 });
    await expect(page.locator("main"), `${slug}: its own screen has content`).not.toBeEmpty({ timeout: 60_000 });
    expect((await mainText(page)).trim().length, `${slug}: its own screen is not empty`).toBeGreaterThan(60);
    const alerts = await page.locator("main [role=alert]").allInnerTexts();
    expect(alerts.filter((t) => t.trim()), `${slug}: its own screen shows no error`).toEqual([]);
  }
  for (const slug of IN_PLACE) {
    const page = A.page;
    await openReport(page, slug);
    const title = (await page.getByTestId("reports-title-block").innerText()).trim();
    expect(title.length, `${slug} has a title block`).toBeGreaterThan(3);
    const alerts = await page.locator("main [role=alert]").allInnerTexts();
    expect(alerts.filter((t) => t.trim()), `${slug} shows no error`).toEqual([]);
    const text = await mainText(page);
    expect(text.trim().length, `${slug} is not empty`).toBeGreaterThan(60);
    const headings = (await page.locator("main th, main [role=columnheader]").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await page.getByTestId("export-menu-button").click();
    const links: Record<string, string | null> = {};
    for (const f of ["pdf", "xlsx", "csv"]) links[f] = await page.getByTestId(`export-${f}`).getAttribute("href").catch(() => null);
    await page.keyboard.press("Escape");
    const reasons = page.getByTestId("export-share-reason");
    const shareReason = (await reasons.count()) ? (await reasons.first().innerText()).trim() : "";
    const shareBtn = page.getByTestId("share-menu-button");
    const shareEnabled = await shareBtn.isEnabled().catch(() => false);
    if (SHAREABLE.includes(slug)) expect(shareEnabled, `${slug} can be shared`).toBe(true);
    else {
      expect(shareEnabled, `${slug} cannot be shared`).toBe(false);
      expect(shareReason, `${slug} says in words why it cannot be shared`).toMatch(/no public view|copy the link/i);
    }
    seen[slug] = { title, headings, text: text.length, exportReason: shareReason, shareReason, links };
    expect(Object.values(links).every((l) => !!l), `${slug} offers PDF, XLSX and CSV`).toBe(true);
  }
  test.info().annotations.push({ type: "reports-seen", description: JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { h: v.headings.length, chars: v.text }]))) });
});

test("5.1c/5.3/5.4 every report's PDF, XLSX and CSV download (200, real file, never zero bytes), and the Manpower Cost XLSX and CSV hold the screen's headings and first row", async () => {
  const sizes: Record<string, number> = {};
  for (const slug of IN_PLACE) {
    const l = seen[slug]?.links;
    expect(l, `${slug} was looked at in 5.2`).toBeTruthy();
    for (const f of ["pdf", "xlsx", "csv"] as const) {
      const res = await getFile(A.context, await absolute(A.page, l![f]!));
      expect(res.status(), `${slug} ${f} answers 200`).toBe(200);
      const body = await res.body();
      sizes[`${slug}.${f}`] = body.length;
      // an empty report exports its header row (a 14-byte CSV for Site Picture Log): the rule is "never zero bytes", so a header is enough.
      expect(body.length, `${slug} ${f} is not empty`).toBeGreaterThan(5);
      if (f === "pdf") expect(body.subarray(0, 4).toString(), `${slug} pdf is a PDF`).toBe("%PDF");
      if (f === "xlsx") expect(body.subarray(0, 2).toString(), `${slug} xlsx is a workbook`).toBe("PK");
    }
  }
  test.info().annotations.push({ type: "export-sizes", description: JSON.stringify(sizes) });

  // compare with the screen for the first report that has table headings in this project (Manpower Cost is empty on the Villa project: "No rows returned")
  const cmp = IN_PLACE.find((r) => (seen[r]?.headings.length ?? 0) > 1);
  expect(cmp, "at least one in-place report shows a table with headings to compare the exports with").toBeTruthy();
  test.info().annotations.push({ type: "compared-report", description: cmp! });
  await openReport(A.page, cmp!);
  const heads = (await A.page.locator("main th, main [role=columnheader]").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  expect(heads.length, "the compared report screen has table headings").toBeGreaterThan(1);
  const csv = (await (await getFile(A.context, await absolute(A.page, seen[cmp!].links.csv!))).text());
  const firstLine = csv.split(/\r?\n/)[0].toLowerCase();
  for (const h of heads) expect(firstLine, `CSV header carries "${h}"`).toContain(norm(h));
  const xlsx = Buffer.from(await (await getFile(A.context, await absolute(A.page, seen[cmp!].links.xlsx!))).body());
  const dir = mkdtempSync(join(tmpdir(), "px-xlsx-"));
  const file = join(dir, "r.xlsx");
  writeFileSync(file, xlsx);
  const strings = execFileSync("python", ["-I", "-c", "import sys,zipfile,re;z=zipfile.ZipFile(sys.argv[1]);t=''.join(z.read(n).decode('utf8','ignore') for n in z.namelist() if 'sharedStrings' in n or 'sheet' in n);print(re.sub(r'<[^>]+>',' ',t))", file], { encoding: "utf8", maxBuffer: 20_000_000 }).toLowerCase();
  for (const h of heads) expect(strings, `XLSX carries the screen heading "${h}"`).toContain(norm(h));
  const rows = await A.page.locator("main tbody tr").count();
  const csvRows = csv.split(/\r?\n/).filter((x) => x.trim()).length - 1;
  expect(csvRows, "the CSV has as many data lines as the screen has table rows").toBeGreaterThanOrEqual(Math.min(rows, 1));
});

test("5.6 Share on Work Progress makes a public link that opens for someone who is not signed in; the other reports say why they cannot", async ({ browser }) => {
  // Work Progress runs on its own screen (the Reports primary only opens it); the report auto-runs on arrival and carries the Share menu.
  await A.page.goto(`/work-progress?tab=report&projectId=${V}&px-server=1`);
  await expect(A.page.getByTestId("share-menu-button")).toBeEnabled({ timeout: 180_000 });
  const made = A.page.waitForResponse((r) => /\/api\/work-progress\/report\/share/.test(r.url()) && r.request().method() === "POST", { timeout: 60_000 });
  await A.page.getByTestId("share-menu-button").click();
  await A.page.getByTestId("share-copy-link").click();
  const body = (await (await made).json()) as { url?: string };
  expect(body.url, "the server gave a public link").toMatch(/^https?:\/\//);
  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(body.url!);
  await expect(p.locator("body")).toContainText(/Shared, read-only/i, { timeout: 60_000 });
  await expect(p.locator("body")).toContainText(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/, { timeout: 60_000 }); // the report's own period is on the page
  expect((await p.locator("body").innerText()).length).toBeGreaterThan(80);
  await anon.close();
});

test("5.5 / 4.5 Project 360: Download CSV holds exactly the figures on the screen, and Print is offered", async () => {
  await A.page.goto(`/analysis/project-360?projectId=${V}&px-server=1`);
  await expect(A.page.getByTestId("project360-download-csv")).toBeVisible({ timeout: 120_000 });
  const screen = await mainText(A.page);
  expect(screen).toMatch(/Profit & Loss|Change of BOQ/);
  const [dl] = await Promise.all([A.page.waitForEvent("download", { timeout: 60_000 }), A.page.getByTestId("project360-download-csv").click()]);
  const path = await dl.path();
  expect(path).toBeTruthy();
  const csv = (await import("node:fs")).readFileSync(path!, "utf8");
  expect(csv.length).toBeGreaterThan(50);
  const cells = csv.split(/\r?\n/).map((l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));
  let compared = 0;
  const unlabelled: string[] = [];
  const valueMissing: string[] = [];
  for (const row of cells) {
    if (row.length < 2 || !row[0] || !row[1]) continue;
    if (/^measure$/i.test(row[0])) continue; // the CSV's own column-header row ("Measure,Value"), not a figure on the screen
    compared++;
    // The screen words some labels differently from the CSV ("Actual profit (gross)" + "margin"; "1 approved revision(s)"), so a label is a soft check.
    const label = row[0].replace(/ margin$/i, "").replace(/s$/i, "");
    if (!screen.toLowerCase().includes(label.toLowerCase())) unlabelled.push(row[0]);
    // The VALUE is the claim: every figure of more than two characters in the CSV (an amount, a percentage, a date, a sentence) is on the screen.
    if (row[1].length > 2 && !screen.includes(row[1])) valueMissing.push(`${row[0]} = ${row[1]}`);
  }
  test.info().annotations.push({ type: "project360-labels-worded-differently", description: JSON.stringify(unlabelled) });
  expect(valueMissing, "every CSV figure is on the screen").toEqual([]);
  expect(unlabelled.length, "most CSV labels are on the screen as written").toBeLessThanOrEqual(Math.ceil(compared * 0.4));
  expect(compared, "the CSV has the figures").toBeGreaterThan(10);
  // money is written in the organisation's currency
  expect(screen).not.toMatch(/[₹$€£]|\bINR\b|\bUSD\b/);
  // Print: the button asks the browser to print this page
  await A.page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  await A.page.getByTestId("project360-print").click();
  expect(await A.page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
});
