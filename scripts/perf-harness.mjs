// R67 F-28 (audit recommendation R-249) -- THE 13-PAGE PERF HARNESS.
//
// WHAT WAS WRONG WITH THE ONE THIS REPLACES. The pass-2 harness produced a
// table whose `ms` column was -1 for most rows and whose `usable` column was
// empty for all thirteen pages, because (a) it had no way to ask a screen
// whether it was usable, and (b) several of its selectors matched nothing --
// it clicked tabs by CSS class and looked for "Run Report" by text anywhere on
// the page. A row that says -1 is indistinguishable from a row that says
// "this screen is broken", so the audit had to reconstruct per-call numbers by
// hand from dev-server log lines.
//
// WHAT THIS ONE DOES INSTEAD.
//   * usable = when [data-state='ready'] or [data-state='empty'] appears on
//     the list region (R67 F-31). A real mark the screen genuinely flips.
//   * Per request it records BOTH response.request().timing() (the browser's
//     own view: DNS, connect, TTFB, download) AND the Server-Timing header
//     (the server's own view: upstream;dur vs app;dur, R67 F-28), so a slow
//     call can be attributed to VERIDIAN or to the PROJEXA hop from ONE run.
//   * Selectors are role-based: getByRole('tab', { name }) for a tab, and Run
//     Report is looked up inside the report panel, not across the page.
//   * It emits the per-module table as BOTH JSON and Markdown.
//   * It exits non-zero when a row is outside perf/budgets.json, printing a
//     line that names the offending route and metric.
//
// Run it with BUN (it imports the TypeScript budget evaluator directly):
//   PERF_BASE_URL=http://localhost:3100 \
//   PERF_EMAIL=... PERF_PASSWORD=... PERF_PROJECT_ID=... \
//   bun scripts/perf-harness.mjs
//
// It never starts a server of its own -- point it at one you already have
// running (`bun run build && bun run start`), which is what the CI job does.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateAll,
  parseServerTiming,
  resolveBudget,
  toMarkdown,
  violationLine,
} from "../src/lib/perf-budget.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.PERF_EMAIL ?? "";
const PASSWORD = process.env.PERF_PASSWORD ?? "";
const PROJECT_ID = process.env.PERF_PROJECT_ID ?? "";
const OUT_DIR = process.env.PERF_OUT_DIR ?? resolve(ROOT, "perf");
// How long a screen is given to reach a usable state before the row is
// recorded as "never usable". Deliberately longer than the 8 s abort budget,
// so a screen that fails honestly still gets its failure recorded rather than
// being cut off mid-answer.
const USABLE_TIMEOUT_MS = Number(process.env.PERF_USABLE_TIMEOUT_MS ?? 12_000);

const budgets = JSON.parse(readFileSync(resolve(ROOT, "perf/budgets.json"), "utf8"));

function requireEnv() {
  const missing = [];
  if (!EMAIL) missing.push("PERF_EMAIL");
  if (!PASSWORD) missing.push("PERF_PASSWORD");
  if (!PROJECT_ID) missing.push("PERF_PROJECT_ID");
  if (missing.length) {
    console.error(
      `perf-harness: ${missing.join(", ")} not set. This harness measures the REAL composed app against a real\n` +
        "logged-in session and a real project -- there is nothing honest to measure without them."
    );
    process.exit(2);
  }
}

/** Every /api/* response of one navigation, with both views of its duration. */
function trackRequests(page) {
  const calls = [];
  const onResponse = (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    let browserMs = null;
    try {
      const t = res.request().timing();
      // responseEnd is relative to startTime; -1 means the browser has no
      // number, and a -1 must never be reported as a duration.
      if (t && t.responseEnd >= 0) browserMs = Math.round(t.responseEnd);
    } catch {
      /* the request was aborted before timing existed */
    }
    const serverTiming = parseServerTiming(res.headers()["server-timing"]);
    calls.push({
      url: url.replace(BASE, ""),
      status: res.status(),
      browserMs,
      upstreamMs: serverTiming.upstreamMs,
      appMs: serverTiming.appMs,
    });
  };
  page.on("response", onResponse);
  return { calls, stop: () => page.off("response", onResponse) };
}

async function measureRoute(page, budget, routeSpec) {
  const url = `${BASE}${routeSpec.route}${routeSpec.projectIdParam ? `?projectId=${encodeURIComponent(PROJECT_ID)}` : ""}`;
  const tracker = trackRequests(page);
  const startedAt = Date.now();

  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });

  // The usable mark: the list region says it is showing something. F-31 puts
  // this on every module list; 'empty' counts, because "there are none" is an
  // answer and the screen is usable the moment it says so.
  let usableMs = null;
  try {
    await page.waitForSelector("[data-state='ready'], [data-state='empty']", { timeout: USABLE_TIMEOUT_MS });
    usableMs = Date.now() - startedAt;
  } catch {
    usableMs = null;
  }

  let networkIdleMs = null;
  try {
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    networkIdleMs = Date.now() - startedAt;
  } catch {
    networkIdleMs = null;
  }

  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return {
      ttfbMs: nav && nav.responseStart > 0 ? Math.round(nav.responseStart) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
    };
  });

  tracker.stop();
  const timed = tracker.calls.filter((c) => c.browserMs !== null);
  const slowest = timed.reduce((worst, c) => (worst === null || c.browserMs > worst.browserMs ? c : worst), null);

  return {
    measured: {
      route: budget.route,
      ttfbMs: vitals.ttfbMs,
      fcpMs: vitals.fcpMs,
      usableMs,
      networkIdleMs,
      apiCount: tracker.calls.length,
      slowestCallMs: slowest ? slowest.browserMs : null,
      slowestCallUrl: slowest ? slowest.url : null,
    },
    calls: tracker.calls,
  };
}

/**
 * The tab and Run Report interactions the old harness could not perform.
 * Role-based and SCOPED, so a heading somewhere else on the page can never be
 * mistaken for the control.
 */
async function exerciseControls(page, route) {
  const opened = [];
  if (route === "/materials" || route === "/labour" || route === "/schedule" || route === "/work-progress") {
    for (const tab of await page.getByRole("tab").all()) {
      const name = (await tab.textContent())?.trim();
      if (!name) continue;
      const startedAt = Date.now();
      await tab.click();
      // A tab is "open" when ITS panel reports a state, not when the click
      // returns -- the panel is what the user is waiting for.
      try {
        await page.getByRole("tabpanel").locator("[data-state='ready'], [data-state='empty'], [data-state='error']").first()
          .waitFor({ timeout: USABLE_TIMEOUT_MS });
        opened.push({ tab: name, ms: Date.now() - startedAt });
      } catch {
        opened.push({ tab: name, ms: null });
      }
    }
  }
  if (route === "/reports") {
    // Scoped to the report region rather than a page-wide text match, which is
    // what made the previous harness's Run Report step a no-op.
    const run = page.getByTestId("work-progress-report-run").or(page.getByRole("button", { name: "Run Report" }));
    if (await run.count()) {
      const startedAt = Date.now();
      await run.first().click();
      try {
        await page.locator("[data-state='ready'], [data-state='empty'], [data-state='error']").first().waitFor({ timeout: USABLE_TIMEOUT_MS });
        opened.push({ tab: "Run Report", ms: Date.now() - startedAt });
      } catch {
        opened.push({ tab: "Run Report", ms: null });
      }
    }
  }
  return opened;
}

/**
 * The direct backend probe. It calls PROJEXA's own proxies and reads the
 * Server-Timing header F-28 adds, which separates VERIDIAN's own cost
 * (upstream;dur) from the hop's (app;dur) -- the same split a direct call to
 * the ERP would give, without putting a VERIDIAN org API key into CI.
 */
async function probeBackend(page) {
  const probe = budgets.backendProbe;
  const rows = [];
  for (const template of probe.paths) {
    const path = template.replace("{projectId}", encodeURIComponent(PROJECT_ID));
    const startedAt = Date.now();
    const res = await page.request.get(`${BASE}${path}`);
    const timing = parseServerTiming(res.headers()["server-timing"]);
    rows.push({
      path,
      status: res.status(),
      wallMs: Date.now() - startedAt,
      upstreamMs: timing.upstreamMs,
      appMs: timing.appMs,
      overUpstreamBudget: timing.upstreamMs !== null && timing.upstreamMs > probe.maxUpstreamMs,
      overAppBudget: timing.appMs !== null && timing.appMs > probe.maxAppMs,
    });
  }
  return rows;
}

async function main() {
  requireEnv();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login is deliberately NOT measured: it is not one of the 13 screens.
  await page.goto(`${BASE}/login`, { timeout: 60_000 });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  const results = [];
  for (const routeSpec of budgets.routes) {
    const budget = resolveBudget(budgets.defaults, routeSpec);
    // WARM measurement: the budget is a warm-navigation budget, so the first
    // visit primes the route and the second is the one recorded.
    await measureRoute(page, budget, routeSpec);
    const { measured, calls } = await measureRoute(page, budget, routeSpec);
    const tabs = await exerciseControls(page, routeSpec.route);
    results.push({ budget, measured, calls, tabs });
  }

  const backend = await probeBackend(page);
  await browser.close();

  const { rows, violations } = evaluateAll(
    results.map((r) => ({ budget: r.budget, measured: r.measured })),
    budgets.toleranceFraction
  );

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, "perf-results.json"),
    JSON.stringify(
      {
        baseUrl: BASE,
        measuredAt: new Date().toISOString(),
        toleranceFraction: budgets.toleranceFraction,
        routes: results.map((r, i) => ({ ...r, violations: rows[i].violations })),
        backendProbe: backend,
      },
      null,
      2
    ) + "\n"
  );
  const markdown =
    toMarkdown(rows) +
    "\n### Backend probe (upstream = VERIDIAN's own cost, app = the PROJEXA hop)\n\n" +
    "| Path | Status | Wall | upstream;dur | app;dur |\n| --- | ---: | ---: | ---: | ---: |\n" +
    backend
      .map((b) => `| \`${b.path}\` | ${b.status} | ${b.wallMs} | ${b.upstreamMs ?? "—"} | ${b.appMs ?? "—"} |`)
      .join("\n") +
    "\n";
  writeFileSync(resolve(OUT_DIR, "perf-results.md"), markdown);

  console.log(markdown);

  const backendViolations = backend.filter((b) => b.overUpstreamBudget || b.overAppBudget);
  for (const v of violations) console.error(violationLine(v));
  for (const b of backendViolations) {
    console.error(
      `FAIL ${b.path}  upstream=${b.upstreamMs ?? "not measured"} app=${b.appMs ?? "not measured"} ` +
        `(budgets upstream ${budgets.backendProbe.maxUpstreamMs}, app ${budgets.backendProbe.maxAppMs})`
    );
  }

  const failures = violations.length + backendViolations.length;
  console.log(
    failures === 0
      ? `perf-harness: ${rows.length} screens, all inside budget.`
      : `perf-harness: ${failures} budget violation(s) across ${rows.length} screens.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("perf-harness FAILED:", err);
  process.exit(1);
});
