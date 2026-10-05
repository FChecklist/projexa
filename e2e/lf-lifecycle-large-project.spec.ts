import { test, expect } from "@playwright/test";
import { makePerson, newWorld, personMeta, signIn, stubSyncService } from "./support/lf-lifecycle-stub";

// AUDIT-100 B14 + B15: a LARGE project on the laptop, in real Chromium, production build, local Auth stand-in, sync service answered in the
// browser (see e2e/support/lf-lifecycle-stub.ts). One person, one project, one BOQ of 5,000 lines (about the size of the biggest real BOQ,
// the Dubai tower one is 10,907 lines across revisions). It proves, with a documented budget each:
//   B14  the first install: the "Preparing your PROJEXA workspace" screen closes, then the 5,000 lines are copied; each within a budget, and the
//        percentage shown never goes backwards.
//   B15  the BOQ screen, OFFLINE: draws all 5,000 lines within a budget, the total is exact, and typing in a Category box does not freeze the
//        page (no main-thread task over the budget on any keystroke), and the typed category is still there after a reload (persisted, re-read).
//
// MEASURED (development laptop, 8 GB, production build, 2026-10-05; the machine is shared with other work, so a slow run can be 5x a quiet one):
//   before the row fix (every keystroke re-rendered all 5,000 rows): screen closed 3.2 s, lines copied 1.0 s, BOQ screen ready 5.1-5.7 s,
//     5 keystrokes 6.0-6.1 s, main-thread tasks while typing 0.5-1.0 s each (max 997 ms).
//   after the fix (src/lib/local-first/shell/modules/ScopeObjectScreen.tsx: memoised rows, one stable save function): 5 keystrokes 4.0 s,
//     tasks while typing 558, 222, 90, 97, 86, 87 ms (the first one is the browser laying the table out again when the Save button appears).
//   STILL OPEN (honest): the FIRST draw of 5,000 rows takes 5-9 s on a quiet laptop (and 46 s on one that is starved of memory): every row is
//     real DOM. The fix for that is windowing the table (draw what is on screen), a bigger change than this test's package; tracked in
//     AUDIT_100_CHECKLIST B15. The budget below is therefore a hang detector for the draw (30 s), not a promise of 2 s.
// The deterministic guard against the keystroke regression is the unit test ScopeObjectScreen.test.tsx (it counts the money cells rendered:
// 363 per three keystrokes before the fix, 6 after); this spec proves the same screen in real Chromium and the persisted outcome.
// The install numbers exclude the real network (the stub answers inside the browser), so they are a floor, not the real-server time; the real
// server's time is the owner-device step in AUDIT_100_CHECKLIST B14.
// BUDGETS:
const SCREEN_CLOSES_MS = 60_000;
const DATA_COPIED_MS = 60_000;
const BOQ_SCREEN_READY_MS = Number(process.env.LF_READY_MS ?? 30_000);
const LONG_TASK_MS = 1_500;
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

  // ---- B14: the first install ----
  const started = Date.now();
  await page.goto(`/scope/${A.boqId}`);
  const dialog = page.getByTestId("workspace-prepare");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const percents: number[] = [];
  while ((await dialog.count()) > 0 && Date.now() - started < SCREEN_CLOSES_MS) {
    const txt = await page.locator('[data-testid="prepare-percent"]').textContent({ timeout: 2000 }).catch(() => null);
    const n = txt ? Number.parseInt(txt, 10) : Number.NaN;
    if (Number.isFinite(n)) percents.push(n);
    await page.waitForTimeout(200);
  }
  const closedMs = Date.now() - started;
  await expect(dialog, `the prepare screen was still open after ${SCREEN_CLOSES_MS} ms`).toHaveCount(0);
  expect(percents, "the percentage shown never goes backwards").toEqual([...percents].sort((a, b) => a - b));
  const copyStarted = Date.now();
  await expect.poll(() => personMeta(page, session.userId, `sync:done:${A.projectId}:boq_lines`), { timeout: DATA_COPIED_MS, intervals: [250], message: "the 5,000 lines were never copied to the laptop" }).toBeTruthy();
  const copiedMs = Date.now() - copyStarted;

  // ---- B15: the BOQ screen offline ----
  await context.setOffline(true);
  world.net = "offline";
  const opened = Date.now();
  await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local", { timeout: BOQ_SCREEN_READY_MS });
  await expect(page.getByTestId("boq-local-line")).toHaveCount(LINES, { timeout: BOQ_SCREEN_READY_MS });
  const readyMs = Date.now() - opened;
  const totalText = (await page.getByTestId("boq-local-total").textContent()) ?? "";
  expect(Number.parseFloat(totalText.replace(/[^0-9.]/g, "")), `the total shown is "${totalText}"`).toBeCloseTo(expectedTotal, 0);

  await page.evaluate(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__lt.push(e.duration); }).observe({ type: "longtask" });
  });
  const box = page.locator('[data-line-id="lf-big-line-00004"]').getByTestId("boq-line-category-input");
  const typed = Date.now();
  await box.click();
  await box.pressSequentially("Steel", { delay: 30 });
  const typingMs = Date.now() - typed;
  await expect(box).toHaveValue("Steel");
  const tasks = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
  await box.press("Enter");
  await expect(page.locator('[data-line-id="lf-big-line-00004"]').getByTestId("boq-line-waiting")).toBeVisible();

  console.log(`LARGE PROJECT ${LINES} lines: install screen closed ${closedMs} ms, lines copied ${copiedMs} ms more, BOQ screen ready offline ${readyMs} ms, 5 keystrokes ${typingMs} ms, long tasks while typing ${JSON.stringify(tasks.map(Math.round))} ms; percent shown ${JSON.stringify(percents)}`);
  expect(closedMs).toBeLessThan(SCREEN_CLOSES_MS);
  expect(readyMs).toBeLessThan(BOQ_SCREEN_READY_MS);
  expect(Math.max(0, ...tasks), `a keystroke froze the page for ${Math.max(0, ...tasks)} ms (limit ${LONG_TASK_MS} ms)`).toBeLessThan(LONG_TASK_MS);

  // persisted, re-read: the category is on the laptop after a reload
  await page.reload();
  await expect(page.getByTestId("boq-local-line")).toHaveCount(LINES, { timeout: BOQ_SCREEN_READY_MS });
  await expect(page.locator('[data-line-id="lf-big-line-00004"]').getByTestId("boq-line-category-input")).toHaveValue("Steel");
});
