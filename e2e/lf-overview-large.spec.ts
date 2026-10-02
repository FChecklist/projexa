import { test, expect, type Page } from "@playwright/test"
import { factLines, goOffline, noCrashText, prepareLaptop, watchConsole } from "./support/lf-overview-harness"
import { P1, P2, createWorld, dayFromToday, type OverviewKind, type Row } from "./support/lf-overview-stub"

// LOCAL-FIRST overview (package lf-e10c): the dashboard with ~5,000 rows on the laptop, offline, in real Chromium. It must become
// interactive within a measured budget and keep the main thread free while the person works the screen.
//
// THE INPUT. No overview screen has a filter box (the dashboard, reports and analysis screens of the shell have none); the one control the
// person types into on the dashboard is the header's project switcher, and switching to the big project is what recounts all ~5,000 rows.
// So the long-task budget is measured while the person switches projects WITH THE KEYBOARD (focus the switcher, ArrowUp/ArrowDown),
// using the same long-task observer as e2e/boq-worker-filter.spec.ts, first proved able to see a long task.
//
// BUDGETS (measured on the cloud runner, 4 cores, lf-e10c 2026-10-02: 382 ms to draw the facts of 5,142 rows, switches 72-232 ms, no long
// task at all; the measurement is printed on every run): the dashboard's local facts drawn within 2,000 ms of the navigation (about five
// times the measurement, for a slower laptop), and no main-thread task of 200 ms or more while switching.

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

type Measured = { __ovLongTasks?: number[]; __ovObserver?: PerformanceObserver }

async function startLongTaskObserver(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Measured
    w.__ovLongTasks = []
    w.__ovObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__ovLongTasks!.push(e.duration) })
    w.__ovObserver.observe({ type: "longtask" })
  })
  // proved able to see a task: a 120 ms busy loop must be reported
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => { const s = performance.now(); while (performance.now() - s < 120) { /* hold the main thread */ } resolve() }, 0)))
  await expect.poll(() => page.evaluate(() => ((window as unknown as Measured).__ovLongTasks ?? []).filter((d) => d >= 100).length), { timeout: 10_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  await page.evaluate(() => { (window as unknown as Measured).__ovLongTasks = [] })
}
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as Measured).__ovLongTasks ?? [])

test("~5,000 rows on the laptop: the dashboard is interactive within budget offline, and switching projects by keyboard never blocks the main thread for 200 ms", async ({ page, context }) => {
  const consoleWatch = watchConsole(page)
  const extra = bigRows()
  const world = createWorld({ role: "manager", extraRows: extra })
  const total = Object.values(world.rows[P1.id]!).reduce((n, list) => n + list.length, 0)
  expect(total).toBeGreaterThanOrEqual(5000)
  const prepared = await prepareLaptop(page, context, world)
  await goOffline(context, prepared)

  let loadMs = 0
  await test.step("offline: the dashboard of the big project draws its facts within 2,000 ms, and they are exact", async () => {
    await page.goto(`/local?projectId=${P2.id}`)
    await expect(page.getByTestId("local-shell-home")).toBeVisible()
    const started = Date.now()
    await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Dashboard", exact: true }).click()
    await page.getByTestId("local-shell-project").selectOption(P1.id)
    await expect(page.getByTestId("overview-fact-tasks").locator("[data-state=local]")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${P1.name}`)
    loadMs = Date.now() - started
    const tasks = world.current(P1.id, "tasks")
    const open = tasks.filter((t) => t.is_archived !== true && Number(t.completion_percentage) < 100)
    expect((await factLines(page, "overview-fact-tasks"))[0]).toBe(`Not finished: ${open.length}`)
    const rfiOpen = world.current(P1.id, "rfis").filter((r) => r.status === "open").length
    expect(await factLines(page, "overview-fact-rfis")).toContain(`open: ${rfiOpen}`)
    console.log(`dashboard with ${total} rows of ${P1.name}: local facts drawn ${loadMs} ms after the click; budget 2000 ms`)
    expect(loadMs).toBeLessThan(2000)
    await noCrashText(page)
  })

  await test.step("switching between the projects with the keyboard: no main-thread task of 200 ms or more", async () => {
    await startLongTaskObserver(page)
    const switcher = page.getByTestId("local-shell-project")
    const timings: number[] = []
    for (let round = 0; round < 3; round += 1) {
      for (const [key, name] of [["ArrowDown", P2.name], ["ArrowUp", P1.name]] as const) {
        await switcher.focus()
        const t0 = Date.now()
        await page.keyboard.press(key)
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${name}`)
        await expect(page.getByTestId("overview-fact-tasks").locator("[data-state=local]")).toBeVisible()
        timings.push(Date.now() - t0)
      }
    }
    await page.waitForTimeout(500) // a long task is reported after it ends
    const durations = await longTasks(page)
    console.log(`project switches (ms, P2 then P1, three rounds): ${JSON.stringify(timings)}; long tasks (>= 50 ms) meanwhile: ${JSON.stringify(durations.map((d) => Math.round(d)))}; limit 200`)
    expect(Math.max(0, ...durations), `main-thread tasks while switching, ms: ${JSON.stringify(durations.map((d) => Math.round(d)))}`).toBeLessThan(200)
    // the last switch landed on the big project and its figure is still exact
    expect((await factLines(page, "overview-fact-tasks"))[0]).toBe(`Not finished: ${world.current(P1.id, "tasks").filter((t) => t.is_archived !== true && Number(t.completion_percentage) < 100).length}`)
  })

  consoleWatch.check("with 5,000 rows")
})
