import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Sumeet's 31-item directive ("PROJEXA-AI.COM SHOULD BE ABLE TO CAPTURE,
// ANALYZE, FIX, ALL OF THESE") -- the 28-item deterministic exceptions
// report (compliance-tracker PR #1752, PROJEXA PR #286). GAP FOUND
// (2026-09-19, Playwright gap-closure sweep, same finding as the sibling
// sumeet-billing-milestones-env1.spec.ts): no Playwright coverage existed
// for this feature at all before this file, only Bun unit/route/component
// tests. Read-only by design (ExceptionsClient.tsx's own header), so this
// spec only ever reads -- no setup mutation needed.
//
// Runs against Env-1 (localhost:3000/3100, PLAYWRIGHT_BASE_URL override),
// real browser, real HTTP, real Postgres -- not a mock.
test.use({ storageState: "playwright/.auth/ceo.json" });

const PROJECT_ID = DEFAULT_PROJECT.id;

test("Sumeet #29-31: the 28-item exceptions report renders all real checks with their real formulas", async ({ page }) => {
  // e2e-env1 CI fix (2026-09-20), NOT FULLY RESOLVED -- recorded honestly.
  // getProjectExceptions() (construction-exceptions-service.ts) computes
  // all 28 checks in one call, joining 14+ tables -- genuinely heavier
  // than a typical single-resource GET. Two rounds of widening this
  // test's own timeouts (waitForResponse, page.goto, test.setTimeout) are
  // real improvements but did NOT fully fix this test: the underlying
  // /api/exceptions route's own upstream budget (route.ts, PROJEXA side)
  // has independently been raised 8s -> 20s -> 35s -> 60s across this same
  // investigation, and STILL lost the race in the most recent real CI
  // verification (ct-server.log: `"route":"/api/exceptions",...,
  // "status":503,"upstreamMs":60001`) -- meaning this call's real
  // duration under CI load is still unmeasured (it has never been allowed
  // to actually finish), not merely "a bit more than 60s". Test-side
  // timeouts here are set generously (120s test, 90s goto/response) so
  // THIS test is not the bottleneck if/when the upstream budget is raised
  // again or the real fix (parallelizing a subset of the 24 sequential
  // detectors, see route.ts's own comment) lands -- but this test should
  // be expected to still fail intermittently until one of those happens.
  test.setTimeout(120_000);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/exceptions") && r.request().method() === "GET", { timeout: 90_000 }),
    page.goto(`/analysis/exceptions?projectId=${PROJECT_ID}`, { waitUntil: "networkidle", timeout: 90_000 }),
  ]);
  expect(response.ok(), "the real exceptions API must respond successfully, not be mocked or skipped").toBe(true);
  const body = await response.json();
  const checks: Array<{ item: number; title: string; flagged: boolean; count: number; formula: string }> = body.checks ?? [];

  // Real, specific assertion on the DATA the page is rendering from, not
  // just "a page loaded" -- 28 is the exact number of individually
  // testable items in construction-exceptions-service.ts's own header
  // (items 29-31 of the 31 are meta-statements about the system as a
  // whole, not separately checkable).
  expect(checks.length, "getProjectExceptions() must return all 28 individually-testable checks").toBe(28);
  for (const c of checks) {
    expect(c.formula.length, `check #${c.item} ("${c.title}") must carry a real, non-trivial formula string, not a placeholder`).toBeGreaterThan(10);
  }

  // The summary card reflects the SAME real numbers the API returned --
  // reads the count out of the summary text itself rather than assuming a
  // fixed sentence, so this doesn't silently pass if the API/UI drift apart
  // on which of the two possible sentences ("all N checks are clear" vs.
  // "N of M checks are flagged") applies.
  const flaggedCount = checks.filter((c) => c.flagged).length;
  const summaryCard = page.locator("p", { hasText: flaggedCount === 0 ? /all \d+ checks are clear/i : /of \d+ checks are flagged/i });
  await expect(summaryCard, "the summary card must reflect the real flagged/clear count the API returned").toBeVisible();

  // Expand the first check with real flagged records (if any) and confirm
  // its detail rows render from the real API payload, not a placeholder.
  const flaggedWithRecords = checks.find((c) => c.flagged && c.count > 0);
  if (flaggedWithRecords) {
    const row = page.locator("li", { hasText: `#${flaggedWithRecords.item} — ${flaggedWithRecords.title}` });
    await row.getByRole("button").click();
    const detailList = row.locator("ul.mt-2");
    await expect(detailList, "expanding a flagged check must show its real record details, not stay collapsed").toBeVisible({ timeout: 10_000 });
    const detailCount = await detailList.locator("li").count();
    expect(detailCount, "the expanded detail list must show exactly the count the API reported").toBe(flaggedWithRecords.count);
  }
});

test("Sumeet #29-31: the exceptions report is reachable from the Analysis screen list, alongside Project 360", async ({ page }) => {
  await page.goto(`/analysis?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });
  const exceptionsLink = page.getByRole("link", { name: /exceptions/i });
  await expect(exceptionsLink, "the Analysis screen's own list must surface the Exceptions entry, not just a direct URL").toBeVisible();
  await exceptionsLink.click();
  await expect(page).toHaveURL(/\/analysis\/exceptions/);
});
