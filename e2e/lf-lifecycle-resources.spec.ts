import { test, expect, type CDPSession, type Page } from "@playwright/test"
import { noCrashText, prepareLaptop } from "./support/lf-overview-harness"
import { P1, P2, createWorld, dayFromToday, type OverviewKind, type Row } from "./support/lf-overview-stub"
import { apiRoutes, countByDest, leftTheLaptop, trackTraffic } from "./support/lf-vercel-budget"

// AUDIT-100 A21 (user RAM first: heavy work runs on the laptop, and its cost is MEASURED) in a real Chromium on a production build:
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-resources
//
// What is read, straight from the browser (Chrome DevTools Protocol Performance.getMetrics after a forced garbage collection, plus the Storage and Cache
// Storage APIs), never from what the page says about itself:
//   * retained JavaScript heap (MB), DOM nodes, event listeners;
//   * main-thread time spent (TaskDuration, ScriptDuration, LayoutDuration, seconds) while a phase runs;
//   * the storage the install and the data use (navigator.storage.estimate: IndexedDB + Cache Storage), and the release cache's own bytes.
// Phases: (1) the one-time install of a person with ~5,100 rows (the same big project as lf-overview-large); (2) opening the heavy Dashboard (every row
// counted on the laptop); (3) a walk of every module. The heavy work must not go to the server: the Dashboard window makes no /api call except the
// usage beacon and the one dashboard snapshot, and no app page.
//
// MEASURED 2026-10-05 on the fast rig (Windows laptop, 8 GB RAM, Chromium headless, local stand-ins): see the BUDGETS block; the measurement is printed
// on every run (A21 ...). The budgets are 5x to 8x the measurement, so a slower laptop passes and a real regression (a leak, a 10x slower screen, a
// bloated install) does not. Raising one is a deliberate act: say why in the commit.

test.use({ timezoneId: "UTC" })

const BIG: Partial<Record<OverviewKind, number>> = { tasks: 2000, progress: 1500, rfis: 600, punch_list: 500, submittals: 300, milestones: 100 }
const STATUSES = ["open", "answered", "closed", "in_progress"]
function bigRows(): Partial<Record<OverviewKind, Row[]>> {
  const activities = Array.from({ length: 100 }, (_, i) => ({ id: `big-a${i}`, name: `Activity ${i}` }))
  return {
    activities,
    tasks: Array.from({ length: BIG.tasks! }, (_, i) => ({ id: `big-t${String(i).padStart(5, "0")}`, title: `Task ${i}`, completion_percentage: (i * 7) % 101, due_date: dayFromToday((i % 30) - 10), is_archived: i % 50 === 0 })),
    progress: Array.from({ length: BIG.progress! }, (_, i) => ({ id: `big-pe${i}`, activity_id: `big-a${i % 100}`, percent_complete: (i * 13) % 101, entry_date: dayFromToday(-(i % 60)), created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}Z` })),
    rfis: Array.from({ length: BIG.rfis! }, (_, i) => ({ id: `big-r${i}`, number: 100 + i, subject: `RFI ${i}`, status: STATUSES[i % 3] })),
    punch_list: Array.from({ length: BIG.punch_list! }, (_, i) => ({ id: `big-pl${i}`, title: `Punch ${i}`, status: STATUSES[(i % 2) * 3] })),
    submittals: Array.from({ length: BIG.submittals! }, (_, i) => ({ id: `big-s${i}`, title: `Submittal ${i}`, status: i % 4 === 0 ? "approved" : "pending" })),
    milestones: Array.from({ length: BIG.milestones! }, (_, i) => ({ id: `big-m${i}`, name: `Milestone ${i}`, target_date: dayFromToday(i % 14), status: i % 5 === 0 ? "completed" : "pending" })),
  }
}

// ─── BUDGETS (5x to 8x the measurement of 2026-10-05: heap 5.2 / 5.6 / 7.7 MB, install 0.8 s, heavy Dashboard 0.8 s, 41-module walk 5.2 s, storage 13.6 MB, release cache 8.9 MB) ───
const BUDGETS = {
  heapAfterInstallMb: 40,
  heapAfterHeavyScreenMb: 50,
  heapAfterWalkMb: 60,
  domNodesHeavyScreen: 5_000,
  installMainThreadSeconds: 10,
  heavyScreenMainThreadSeconds: 3,
  walkMainThreadSeconds: 20,
  storageAfterInstallMb: 60,
  releaseCacheMb: 25,
}

type Metrics = { heapMb: number; nodes: number; listeners: number; taskS: number; scriptS: number; layoutS: number }

async function metrics(cdp: CDPSession): Promise<Metrics> {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {})
  const { metrics: list } = await cdp.send("Performance.getMetrics")
  const m = Object.fromEntries(list.map((x) => [x.name, x.value]))
  return {
    heapMb: Math.round(((m.JSHeapUsedSize ?? 0) / 1_048_576) * 10) / 10,
    nodes: m.Nodes ?? 0,
    listeners: m.JSEventListeners ?? 0,
    taskS: Math.round((m.TaskDuration ?? 0) * 100) / 100,
    scriptS: Math.round((m.ScriptDuration ?? 0) * 100) / 100,
    layoutS: Math.round((m.LayoutDuration ?? 0) * 100) / 100,
  }
}

async function storage(page: Page): Promise<{ usageMb: number; releaseCacheMb: number }> {
  return page.evaluate(async () => {
    const est = await navigator.storage.estimate()
    let bytes = 0
    for (const name of (await caches.keys()).filter((n) => n.startsWith("px-release-"))) {
      const c = await caches.open(name)
      for (const req of await c.keys()) {
        const res = await c.match(req)
        if (res) bytes += (await res.clone().blob()).size
      }
    }
    return { usageMb: Math.round(((est.usage ?? 0) / 1_048_576) * 10) / 10, releaseCacheMb: Math.round((bytes / 1_048_576) * 10) / 10 }
  })
}

test("A21: the install of a ~5,100-row person and the heavy Dashboard run on the laptop inside a memory, CPU and storage budget, and the heavy work never goes to the server", async ({ page, context }) => {
  test.setTimeout(420_000)
  const world = createWorld({ role: "manager", extraRows: bigRows() })
  const total = Object.values(world.rows[P1.id]!).reduce((n, list) => n + list.length, 0)
  expect(total, "the big project is not big").toBeGreaterThanOrEqual(5000)
  const cdp = await context.newCDPSession(page)
  await cdp.send("Performance.enable")
  const traffic = trackTraffic(context)

  const base = await metrics(cdp)
  await prepareLaptop(page, context, world)
  await page.waitForTimeout(2_000)
  const afterInstall = await metrics(cdp)
  const storeInstall = await storage(page)
  console.log(`A21 baseline ${JSON.stringify(base)}`)
  console.log(`A21 after install (${total} rows) ${JSON.stringify(afterInstall)} storage ${JSON.stringify(storeInstall)}`)

  await page.goto(`/local?projectId=${P2.id}`)
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 30_000 })
  const before = await metrics(cdp)
  const heavy = traffic.mark()
  const started = Date.now()
  await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Dashboard", exact: true }).click()
  await page.getByTestId("local-shell-project").selectOption(P1.id)
  await expect(page.getByTestId("overview-fact-tasks").locator("[data-state=local]")).toBeVisible({ timeout: 30_000 })
  const heavyMs = Date.now() - started
  await page.waitForTimeout(1_500)
  const afterHeavy = await metrics(cdp)
  const heavySeen = leftTheLaptop(heavy())
  console.log(`A21 heavy Dashboard drawn in ${heavyMs} ms; main thread +${(afterHeavy.taskS - before.taskS).toFixed(2)} s (script +${(afterHeavy.scriptS - before.scriptS).toFixed(2)} s); ${JSON.stringify(afterHeavy)}; to the server ${JSON.stringify(countByDest(heavySeen))} api=${JSON.stringify(apiRoutes(heavySeen))}`)

  const walk = traffic.mark()
  const nav = page.getByRole("navigation", { name: "Modules" })
  const entries = await nav.getByRole("link").evaluateAll((links) => links.map((a) => (a.textContent ?? "").trim()))
  for (const label of entries) {
    await nav.getByRole("link", { name: label, exact: true }).click()
    await page.waitForTimeout(250)
  }
  await noCrashText(page)
  const afterWalk = await metrics(cdp)
  const storeWalk = await storage(page)
  const walkSeen = leftTheLaptop(walk())
  console.log(`A21 after walking ${entries.length} modules ${JSON.stringify(afterWalk)} storage ${JSON.stringify(storeWalk)} to the server ${JSON.stringify(countByDest(walkSeen))}`)

  // the heavy work stayed on the laptop
  expect(countByDest(heavySeen)["vercel-page"], "the heavy screen loaded an app page from the server").toBe(0)
  expect(Object.keys(apiRoutes(heavySeen)).filter((k) => !/client-error|dashboard\/project/.test(k)), "the heavy screen called Vercel").toEqual([])
  expect(countByDest(walkSeen)["vercel-api"], "the module walk called Vercel").toBeLessThanOrEqual(2)

  // the budgets
  expect(afterInstall.heapMb, "retained heap after the install").toBeLessThanOrEqual(BUDGETS.heapAfterInstallMb)
  expect(afterHeavy.heapMb, "retained heap with the heavy Dashboard open").toBeLessThanOrEqual(BUDGETS.heapAfterHeavyScreenMb)
  expect(afterWalk.heapMb, "retained heap after walking every module").toBeLessThanOrEqual(BUDGETS.heapAfterWalkMb)
  expect(afterHeavy.nodes, "DOM nodes of the heavy screen").toBeLessThanOrEqual(BUDGETS.domNodesHeavyScreen)
  expect(afterInstall.taskS - base.taskS, "main-thread seconds of the install").toBeLessThanOrEqual(BUDGETS.installMainThreadSeconds)
  expect(afterHeavy.taskS - before.taskS, "main-thread seconds of opening the heavy Dashboard").toBeLessThanOrEqual(BUDGETS.heavyScreenMainThreadSeconds)
  expect(afterWalk.taskS - afterHeavy.taskS, "main-thread seconds of walking every module").toBeLessThanOrEqual(BUDGETS.walkMainThreadSeconds)
  expect(storeInstall.usageMb, "storage used after the install").toBeLessThanOrEqual(BUDGETS.storageAfterInstallMb)
  expect(storeInstall.releaseCacheMb, "the release cache's own size").toBeLessThanOrEqual(BUDGETS.releaseCacheMb)
  expect(storeInstall.releaseCacheMb, "the release cache is empty: it is not measuring the install").toBeGreaterThan(0.5)
  expect(afterHeavy.heapMb, "no heap was measured").toBeGreaterThan(1)
  traffic.stop()
})
