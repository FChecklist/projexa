import { test, expect, type Page } from "@playwright/test";
import { databases, deviceMeta, makePerson, newWorld, personMeta, signIn, stubSyncService } from "./support/lf-lifecycle-stub";

/** The verified release recorded on the laptop (meta app:release), without creating the database if it does not exist yet. */
async function installedRelease(page: Page): Promise<boolean> {
  if (!(await databases(page).catch(() => [] as string[])).includes("projexa-local")) return false;
  const rel = (await deviceMeta(page, "app:release").catch(() => undefined)) as { version?: string } | undefined;
  return Boolean(rel?.version);
}

// AUDIT-100 B14 + B15: a LARGE project on the laptop, in real Chromium, production build, local Auth stand-in, sync service answered in the
// browser (see e2e/support/lf-lifecycle-stub.ts). One person, one project, one BOQ of 5,000 lines (about the size of the biggest real BOQ,
// the Dubai tower one is 10,907 lines across revisions). It proves, with a documented budget each:
//   B14  the FIRST INSTALL of PROJEXA on the laptop over a slow-4G link: the real release (747 files, 8.9 MB, sent as a 2.6 MB bundle) comes over
//        Chromium's own throttled network (CDP Network.emulateNetworkConditions, DevTools' "slow 4G": 150 ms, 1.6 Mbps down), the sync stub's
//        answers wait the same link (world.link), the "Preparing your PROJEXA workspace" screen closes within INSTALL_BUDGET_MS with a verified
//        release installed, and the progress is honest: 100% is never shown before PROJEXA is installed and the percentage never goes down
//        (every value the screen shows is recorded by a MutationObserver, not sampled).
//   B15  the BOQ screen, OFFLINE: shows the 5,000-line table within a budget (windowed: the lines on screen are real rows, the table still
//        reports 5,001 rows and the last line is reached by scrolling), the total is exact, and typing in a Category box does not freeze the
//        page (no main-thread task over the budget on any keystroke), and the typed category is still there after a reload (persisted, re-read).
//
// MEASURED (development laptop, 8 GB, production build, 2026-10-05; the machine is shared with other work, so a slow run can be 5x a quiet one):
//   before the row fix (every keystroke re-rendered all 5,000 rows): screen closed 3.2 s, lines copied 1.0 s, BOQ screen ready 5.1-5.7 s,
//     5 keystrokes 6.0-6.1 s, main-thread tasks while typing 0.5-1.0 s each (max 997 ms).
//   after the fix (src/lib/local-first/shell/modules/ScopeObjectScreen.tsx: memoised rows, one stable save function): 5 keystrokes 4.0 s,
//     tasks while typing 558, 222, 90, 97, 86, 87 ms (the first one is the browser laying the table out again when the Save button appears).
//   the FIRST draw of 5,000 rows took 5-9 s on a quiet laptop (and 46 s on one starved of memory): every row was real DOM.
//   after windowing (use-row-window.ts + row-window.ts: only the lines on screen plus a margin are real rows, the rest are spacers), 7 runs:
//     BOQ screen ready offline 0.70-1.74 s (this includes reading the 5,000 lines from the laptop's copy), 40 rows drawn, longest task while
//     opening 54-92 ms, key to next frame 5-44 ms, no task over 50 ms while typing (one of 50 ms once), scroll to the last line ~0.2 s.
//   the SAME spec against the old screen (every row drawn): ready 13.5 s, tasks while opening 1662, 1754, 899 ms -> fails both budgets below.
// So the budgets are real budgets, not hang detectors (the old one was 30 s): ready 3 s, longest task while opening 0.5 s, key to next frame
// 100 ms, longest task while typing 100 ms. Each can be loosened for a slow machine with LF_READY_MS / LF_DRAW_MS / LF_KEY_MS / LF_TASK_MS.
// The deterministic guards are the unit tests ScopeObjectScreen.test.tsx (money cells rendered: 363 per three keystrokes before the row fix,
// 6 after; 10,000 on the first draw of 5,000 lines before windowing, at most 121 after) and row-window.test.ts (the windowing math); this spec
// proves the same screen in real Chromium: the draw, the keys, scrolling to the last line, focus kept, Enter-to-save and the persisted outcome.
// B14 MEASURED (same laptop, fast rig = production build on localhost, 2026-10-05, slow 4G as above), two runs:
//   bundle 2,625,779 bytes in 13.5 s (its size at 1.6 Mbps is 13.1 s: the throttle is real; unthrottled it arrives in 64 ms), release installed
//   at 22.0 / 23.5 s, screen closed 22.3 / 24.0 s, the 5,000 lines copied 0.02 / 0.3 s after that (the copy runs beside the install), percent
//   shown 0, 15, 24, 33, 42, 51, 60, 70 (the screen lets the person in at 70%: install done, copy finishing; 100 only when everything is done).
//   BUDGET: 60 s for the install (2.5x the measured 24 s, so a busy laptop still passes; the screen itself promises "up to 3 minutes").
// SEEN TO FAIL (each mutation applied to this file, run, then reverted; file byte-identical afterwards):
//   B14-M1 the release bundle held back 45 s by a route  -> "the first install took 67221 ms on slow 4G (budget 60000 ms)"
//   B14-M2 the throttle call removed                     -> "the bundle arrived faster than the slow-4G link allows" (64 ms, needs > 10,503)
//   B14-M3 the screen shows 100% at once                  -> "the screen said 100% before PROJEXA was installed"
//   B14-M4 the screen drops from 24% to 10%               -> "the percentage shown never goes backwards"
// The real server's install time on a second laptop stays the owner-device step in AUDIT_100_CHECKLIST B14.
// BUDGETS:
// "slow 4G" (Chrome DevTools' own preset numbers): 150 ms round trip, 1.6 Mbps down, 750 kbps up. The real release over it: the bundle alone is
// 2.6 MB, so about 13 s of pure transfer.
const SLOW_4G = { latencyMs: 150, downBytesPerSec: Math.round(1.6e6 / 8), upBytesPerSec: Math.round(750e3 / 8) };
const INSTALL_BUDGET_MS = 60_000;
const INSTALL_CAP_MS = 180_000; // the screen's own promise ("up to 3 minutes", PREPARE_BUDGET_MS): the loop stops waiting there
const DATA_COPIED_MS = 120_000;
const DATA_COPIED_BUDGET_MS = 30_000;
// from opening the BOQ address (offline) to the screen showing its lines: page load from the laptop's copy, reading 5,000 lines, the draw.
const BOQ_SCREEN_READY_MS = Number(process.env.LF_READY_MS ?? 3_000);
// the longest single main-thread task while the screen opens: the draw of the table is one such task (the page cannot respond during it)
const DRAW_TASK_MS = Number(process.env.LF_DRAW_MS ?? 500);
// a key pressed in a Category box to the next frame the browser draws, and the longest main-thread task while typing
const KEY_TO_FRAME_MS = Number(process.env.LF_KEY_MS ?? 100);
const LONG_TASK_MS = Number(process.env.LF_TASK_MS ?? 100);
const LINES = 5000;

test("a 5,000-line project installs within budget and its BOQ screen stays fast offline", async ({ page, context }) => {
  const A = makePerson("big", "lf-org-big", "Large Tower", "Large Tower - Structure");
  A.lines = Array.from({ length: LINES }, (_, i) => ({
    id: `lf-big-line-${String(i + 1).padStart(5, "0")}`, boqId: A.boqId, boqTitle: A.boqTitle, boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: `BIG-${i + 1}`, category: i % 7 === 0 ? "Concrete" : "", description: `Large Tower item ${i + 1}`, unit: "m2", quantity: String(1 + (i % 90)), rate: "12.50",
    amount: ((1 + (i % 90)) * 12.5).toFixed(2), createdAt: `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
  }));
  const expectedTotal = A.lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const world = newWorld();
  await stubSyncService(context, world);
  const { session } = await signIn(page, context, world, A);

  // ---- B14: the first install, over a slow-4G link ----
  // Every percentage the screen ever shows, with the time it was shown (a MutationObserver: no sample is missed between two polls).
  await page.addInitScript(() => {
    const w = window as unknown as { __pct: { p: number; t: number }[] };
    w.__pct = [];
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="prepare-percent"]');
      const n = el ? Number.parseInt(el.textContent ?? "", 10) : Number.NaN;
      if (Number.isFinite(n) && w.__pct[w.__pct.length - 1]?.p !== n) w.__pct.push({ p: n, t: Date.now() });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  // The release files reach the page over Chromium's own throttled network (the installer's requests bypass the service worker: sw-core.ts).
  const release: { url: string; bytes: number; ms: number }[] = [];
  page.on("requestfinished", async (req) => {
    if (!req.url().includes("/_release/")) return;
    const size = await req.sizes().catch(() => null);
    const t = req.timing();
    release.push({ url: req.url(), bytes: size?.responseBodySize ?? 0, ms: t.responseEnd });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: SLOW_4G.latencyMs, downloadThroughput: SLOW_4G.downBytesPerSec, uploadThroughput: SLOW_4G.upBytesPerSec });
  world.link = { latencyMs: SLOW_4G.latencyMs, bytesPerSec: SLOW_4G.downBytesPerSec };

  const started = Date.now();
  await page.goto(`/scope/${A.boqId}`);
  const dialog = page.getByTestId("workspace-prepare");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  let installedAt = 0;
  while ((await dialog.count()) > 0 && Date.now() - started < INSTALL_CAP_MS) {
    if (!installedAt && (await installedRelease(page))) installedAt = Date.now();
    await page.waitForTimeout(100);
  }
  const closedMs = Date.now() - started;
  await expect(dialog, `the prepare screen was still open after ${INSTALL_CAP_MS} ms`).toHaveCount(0);
  await expect.poll(() => installedRelease(page), { message: "the screen closed but no verified release is installed (meta app:release)" }).toBeTruthy();
  if (!installedAt) installedAt = Date.now();
  const percents = await page.evaluate(() => (window as unknown as { __pct: { p: number; t: number }[] }).__pct);
  const bundle = release.find((r) => r.url.endsWith(".tar.gz"));

  // the slow link really carried the release: the bundle came over the network and took at least its size at 1.6 Mbps
  expect(bundle, `the release bundle was never downloaded (release requests: ${JSON.stringify(release)})`).toBeTruthy();
  expect(bundle!.bytes, "the release bundle is the real one (2.6 MB gzip of 747 files / 8.9 MB)").toBeGreaterThan(1_000_000);
  expect(bundle!.ms, `the bundle arrived faster than the slow-4G link allows: the throttle is not applied`).toBeGreaterThan((bundle!.bytes / SLOW_4G.downBytesPerSec) * 1000 * 0.8);
  // honest progress: 100 is shown only once everything is installed, and the percentage never goes down
  const early100 = percents.filter((s) => s.p >= 100 && s.t < installedAt);
  expect(early100, `the screen said 100% before PROJEXA was installed (installed at ${installedAt}): ${JSON.stringify(percents)}`).toEqual([]);
  const shown = percents.map((s) => s.p);
  expect(shown, "the percentage shown never goes backwards").toEqual([...shown].sort((a, b) => a - b));
  expect(shown.length, `the screen showed no progress at all: ${JSON.stringify(shown)}`).toBeGreaterThan(2);

  const copyStarted = Date.now();
  await expect.poll(() => personMeta(page, session.userId, `sync:done:${A.projectId}:boq_lines`), { timeout: DATA_COPIED_MS, intervals: [250], message: "the 5,000 lines were never copied to the laptop" }).toBeTruthy();
  const copiedMs = Date.now() - copyStarted;
  console.log(`B14 FIRST INSTALL over slow 4G (${SLOW_4G.latencyMs} ms, 1.6 Mbps): screen closed ${closedMs} ms, release installed at ${installedAt - started} ms, bundle ${bundle!.bytes} bytes in ${Math.round(bundle!.ms)} ms, ${release.length} release requests, lines copied ${copiedMs} ms more; percent shown ${JSON.stringify(shown)}`);
  // THE BUDGET: PROJEXA is installed on the laptop and the person is let in within INSTALL_BUDGET_MS on slow 4G.
  expect(closedMs, `the first install took ${closedMs} ms on slow 4G (budget ${INSTALL_BUDGET_MS} ms)`).toBeLessThan(INSTALL_BUDGET_MS);
  expect(copiedMs, `copying the 5,000 lines took ${copiedMs} ms more (budget ${DATA_COPIED_BUDGET_MS} ms)`).toBeLessThan(DATA_COPIED_BUDGET_MS);
  // back to the unthrottled rig for B15; the session is closed so it cannot override context.setOffline below (it did: the save went through)
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.detach();
  world.link = undefined;

  // ---- B15: the BOQ screen offline ----
  await context.setOffline(true);
  world.net = "offline";
  // record every long main-thread task from the very start of the page that opens
  await context.addInitScript(() => {
    const w = window as unknown as { __openTasks: number[] };
    w.__openTasks = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__openTasks.push(e.duration); }).observe({ type: "longtask" });
    } catch { /* no long task timing: the array stays empty and the assertion below says so */ }
  });
  const opened = Date.now();
  await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
  // generous waits: the budget is asserted on the measured time below, so a slow run reports its number instead of a bare timeout
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local", { timeout: 120_000 });
  await expect(page.getByTestId("boq-local-line").first()).toBeVisible({ timeout: 120_000 });
  const readyMs = Date.now() - opened;
  const openTasks = await page.evaluate(() => (window as unknown as { __openTasks?: number[] }).__openTasks ?? null);
  expect(openTasks, "long task timing was not recorded").not.toBeNull();
  const drawMs = Math.round(Math.max(0, ...(openTasks ?? [])));
  console.log(`BOQ screen opened offline in ${readyMs} ms; long tasks while opening ${JSON.stringify((openTasks ?? []).map(Math.round))} ms`);
  expect(drawMs, `drawing the BOQ blocked the page for ${drawMs} ms in one task (budget ${DRAW_TASK_MS} ms)`).toBeLessThan(DRAW_TASK_MS);
  expect(readyMs, `the BOQ screen took ${readyMs} ms to show its lines (budget ${BOQ_SCREEN_READY_MS} ms)`).toBeLessThan(BOQ_SCREEN_READY_MS);
  // the table still tells a screen reader it has every line (plus the header row), while only the lines on screen are real rows
  await expect(page.getByTestId("boq-local-table")).toHaveAttribute("aria-rowcount", String(LINES + 1));
  const drawnRows = await page.getByTestId("boq-local-line").count();
  const totalText = (await page.getByTestId("boq-local-total").textContent()) ?? "";
  expect(Number.parseFloat(totalText.replace(/[^0-9.]/g, "")), `the total shown is "${totalText}"`).toBeCloseTo(expectedTotal, 0);

  await page.evaluate(() => {
    const w = window as unknown as { __lt: number[]; __kf: number[] };
    w.__lt = [];
    w.__kf = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__lt.push(e.duration); }).observe({ type: "longtask" });
    // key to the next frame: from the key event's own time stamp (so time it waited in the queue counts) to the next animation frame
    document.addEventListener("keydown", (e) => { const t0 = e.timeStamp; requestAnimationFrame(() => w.__kf.push(performance.now() - t0)); }, true);
  });
  // the 4th line on screen (lines are in the laptop copy's order, not by item code), found by its row position like a screen reader would
  const lineRow = (n: number) => page.locator(`[data-testid="boq-local-line"][aria-rowindex="${n + 1}"]`);
  const target = await lineRow(4).getAttribute("data-line-id");
  const box = page.locator(`[data-line-id="${target}"]`).getByTestId("boq-line-category-input");
  const typed = Date.now();
  await box.click();
  await box.pressSequentially("Steel", { delay: 30 });
  const typingMs = Date.now() - typed;
  await expect(box).toHaveValue("Steel");
  const { tasks, keyFrames } = await page.evaluate(() => {
    const w = window as unknown as { __lt: number[]; __kf: number[] };
    return { tasks: w.__lt, keyFrames: w.__kf };
  });

  // scroll to the very end: the last line is drawn there; the box being typed in, now far off screen, keeps its focus and its draft
  const scrolled = Date.now();
  await page.getByTestId("boq-local-total").scrollIntoViewIfNeeded();
  await expect(lineRow(LINES)).toBeVisible({ timeout: 10_000 });
  const scrollMs = Date.now() - scrolled;
  await expect(box, "the line being typed in lost its focus when it scrolled off screen").toBeFocused();
  await expect(box).toHaveValue("Steel");
  const drawnAtEnd = await page.getByTestId("boq-local-line").count();
  await box.press("Enter"); // Enter saves, though the line is off screen
  await expect(page.locator(`[data-line-id="${target}"]`).getByTestId("boq-line-waiting")).toBeAttached();

  console.log(`LARGE PROJECT ${LINES} lines: install screen closed ${closedMs} ms, lines copied ${copiedMs} ms more, BOQ screen ready offline ${readyMs} ms (${drawnRows} rows drawn, longest task ${drawMs} ms), 5 keystrokes ${typingMs} ms, key to next frame ${JSON.stringify(keyFrames.map(Math.round))} ms, long tasks while typing ${JSON.stringify(tasks.map(Math.round))} ms, scroll to the last line ${scrollMs} ms (${drawnAtEnd} rows drawn)`);
  expect(drawnRows, "every line was drawn as a real row: the table is not windowed").toBeLessThan(200);
  expect(keyFrames.length, "no key reached the page").toBeGreaterThanOrEqual(5);
  expect(Math.max(...keyFrames), `a key took ${Math.round(Math.max(...keyFrames))} ms to reach the screen (budget ${KEY_TO_FRAME_MS} ms)`).toBeLessThan(KEY_TO_FRAME_MS);
  expect(Math.max(0, ...tasks), `a keystroke froze the page for ${Math.max(0, ...tasks)} ms (limit ${LONG_TASK_MS} ms)`).toBeLessThan(LONG_TASK_MS);

  // persisted, re-read: the category is on the laptop after a reload
  await page.reload();
  await expect(page.locator('[data-testid="boq-local-line"][aria-rowindex="2"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(`[data-line-id="${target}"]`).getByTestId("boq-line-category-input")).toHaveValue("Steel");

  // keyboard: Tab goes from one line's Category box to the next line's
  await lineRow(10).getByTestId("boq-line-category-input").focus();
  await page.keyboard.press("Tab");
  await expect(lineRow(11).getByTestId("boq-line-category-input")).toBeFocused();
});
