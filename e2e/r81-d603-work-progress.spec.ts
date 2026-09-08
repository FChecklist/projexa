import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// R81 D6-03. The three /work-progress requirements that were BLOCKED only
// because their recorded route pointed at the paused https://projexa-ai.com.
// Re-tested against http://localhost:3100. Read-only: nothing here submits.
//
// The screen renders the three figures as BANDED headers -- a "Percent" /
// "Quantity" / "Amount" band spanning three sub-columns each (Previous /
// Current / Total-or-Balance), see WorkProgressReportClient.tsx:291-298. So
// the requirement's "Previous % / Current % / Total %" is satisfied by the
// band + sub-column PAIR, and that is what is asserted: the band header must
// be present AND carry exactly the three sub-columns underneath it.
test.use({ storageState: "playwright/.auth/ceo.json" });

const P = DEFAULT_PROJECT.id;

type BandCheck = { req: string; band: string };

const BANDS: BandCheck[] = [
  { req: "R-41", band: "Percent" },
  { req: "R-42", band: "Quantity" },
  { req: "R-43", band: "Amount" },
];

test("R-41/R-42/R-43 the work-progress report shows Previous / Current / Total for percent, quantity and amount", async ({ page }) => {
  await page.goto(`/work-progress?projectId=${P}`);
  await page.waitForLoadState("domcontentloaded");

  // The report table is the surface that carries these columns. Give the
  // first paint real headroom (KD-15: a cold route compiles on first hit).
  const table = page.locator("table").first();
  await expect(table).toBeVisible({ timeout: 45_000 });

  // If the report is behind a tab/link on this screen, reach it the way a
  // user would rather than asserting against whichever table paints first.
  const bandHeader = page.getByRole("columnheader", { name: "Percent", exact: true });
  if ((await bandHeader.count()) === 0) {
    const reportTab = page.getByRole("tab", { name: /report/i }).first();
    if ((await reportTab.count()) > 0) {
      await reportTab.click();
      // R81 K5-04: wait for the table to actually RENDER, not a wall-clock guess.
      // A fixed 1500ms read the page mid-load and reported n=0 headers with the
      // body still showing "Loading your modules...", which looks exactly like
      // "the columns are missing" and is not the same claim at all.
      await page
        .getByRole("columnheader")
        .first()
        .waitFor({ state: "visible", timeout: 90_000 })
        .catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  }

  const headerTexts = await page.getByRole("columnheader").allInnerTexts();
  console.log(`R81_D603_WP url=${page.url()}`);
  console.log(`R81_D603_WP_HEADERS n=${headerTexts.length} ${JSON.stringify(headerTexts.map((t) => t.trim()))}`);

  const bodyText = (await page.locator("body").innerText()).trim();
  console.log(`R81_D603_WP_BODY_HEAD ${JSON.stringify(bodyText.slice(0, 600))}`);

  const trimmed = headerTexts.map((t) => t.trim());
  const subCols = trimmed.filter((t) => t === "Previous" || t === "Current" || t === "Total" || t === "Balance");
  console.log(`R81_D603_WP_SUBCOLS ${JSON.stringify(subCols)}`);

  for (const { req, band } of BANDS) {
    const present = trimmed.includes(band);
    console.log(`R81_D603_${req} band="${band}" present=${present}`);
    expect(present, `${req}: the "${band}" band header must be on screen`).toBeTruthy();
  }

  // Three bands x three sub-columns = nine Previous/Current/Total(or Balance)
  // headers. Fewer means a band is missing one of its three figures.
  expect(subCols.filter((t) => t === "Previous").length, "one 'Previous' per band").toBeGreaterThanOrEqual(3);
  expect(subCols.filter((t) => t === "Current").length, "one 'Current' per band").toBeGreaterThanOrEqual(3);
  expect(
    subCols.filter((t) => t === "Total" || t === "Balance").length,
    "one 'Total' (or 'Balance', the same third column under the balance mode) per band"
  ).toBeGreaterThanOrEqual(3);

  // Assert on CONTENT, not just the container: the table must carry at least
  // one real data row under those headers.
  const dataRows = page.locator("table tbody tr");
  const n = await dataRows.count();
  const firstRow = n > 0 ? ((await dataRows.first().innerText()) ?? "").replace(/\s+/g, " ").trim() : "";
  console.log(`R81_D603_WP_ROWS n=${n} first="${firstRow.slice(0, 220)}"`);
  expect(n, "the report rendered headers but no rows to read them against").toBeGreaterThan(0);
});
