import { test, expect, type Page } from "@playwright/test"
import { dashboardFigures, factLines, goOffline, goOnline, noCrashText, prepareLaptop, serverDown, switcherNames, watchConsole } from "./support/lf-overview-harness"
import { P1, P2, P_SECRET, SERVER_FIGURES, createWorld, dayFromToday, exceptionsBody, type Row, type World } from "./support/lf-overview-stub"

// LOCAL-FIRST overview (package lf-e10c): the DASHBOARD, REPORTS and ANALYSIS screens of the on-laptop shell, opened with NO internet and
// with our server down, in a real Chromium. Every figure is asserted EXACTLY against a value this file computes itself from the stub's
// seeded rows (the non-money counts the laptop works out) or against the server's own answer (the money, which the laptop never computes
// and only shows "As of ..., from this laptop"). Role visibility: a manager sees money; a client viewer gets the server's redacted answer
// and the screen must not dress a hidden figure up as a real one. A project the person may not read never reaches the laptop.
//
// Runs through playwright.local-first.config.ts (a production build, the release bundle, the local Auth stand-in); the sync service and
// every /api call are answered in the browser by e2e/support/lf-overview-stub.ts. Nothing reaches a real network.

test.use({ timezoneId: "UTC" })

// ─── the expected figures, computed here from the seeded rows (independently of src/) ─────────────────────────────

const pct = (r: Row, k: string) => Number(r[k])
const isFinished = (t: Row) => pct(t, "completion_percentage") >= 100
function expectedTasks(rows: Row[]) {
  const today = dayFromToday(0)
  const weekEnd = dayFromToday(6)
  const open = rows.filter((t) => t.is_archived !== true && !isFinished(t))
  const due = (t: Row) => (typeof t.due_date === "string" ? t.due_date : null)
  return [
    `Not finished: ${open.length}`,
    `Due this week: ${open.filter((t) => due(t) !== null && due(t)! >= today && due(t)! <= weekEnd).length}`,
    `Overdue: ${open.filter((t) => due(t) !== null && due(t)! < today).length}`,
  ]
}
function expectedByStatus(rows: Row[]) {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(String(r.status ?? "unknown"), (counts.get(String(r.status ?? "unknown")) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, n]) => `${s.replace(/_/g, " ")}: ${n}`)
}
function expectedActivities(activities: Row[], progress: Row[]) {
  const latest = new Map<string, { key: string; pct: number }>()
  for (const e of progress) {
    const id = String(e.activity_id)
    if (!activities.some((a) => a.id === id)) continue
    const key = `${e.entry_date}|${e.created_at}`
    if (!latest.has(id) || key > latest.get(id)!.key) latest.set(id, { key, pct: Number(e.percent_complete) })
  }
  const states = activities.map((a) => (latest.has(a.id) ? (latest.get(a.id)!.pct >= 100 ? "complete" : "progress") : "none"))
  return [`Not started: ${states.filter((s) => s === "none").length}`, `In progress: ${states.filter((s) => s === "progress").length}`, `Complete: ${states.filter((s) => s === "complete").length}`]
}
function expectedMilestonesThisWeek(rows: Row[]) {
  const today = dayFromToday(0)
  const weekEnd = dayFromToday(6)
  return rows.filter((m) => !/^(done|complete|completed|achieved|closed|cancelled|canceled)$/i.test(String(m.status)) && String(m.target_date) >= today && String(m.target_date) <= weekEnd).length
}
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percent = (n: number) => `${Math.round(n * 10) / 10}%`

async function expectDashboardFacts(page: Page, world: World, projectId: string) {
  const rows = (k: Parameters<World["current"]>[1]) => world.current(projectId, k)
  await expect(page.getByTestId("overview-fact-tasks").locator("[data-state=local]")).toBeVisible()
  expect(await factLines(page, "overview-fact-tasks")).toEqual(expectedTasks(rows("tasks")))
  expect(await factLines(page, "overview-fact-activities")).toEqual(expectedActivities(rows("activities"), rows("progress")))
  await expect(page.getByTestId("overview-fact-milestones")).toContainText(String(expectedMilestonesThisWeek(rows("milestones"))))
  expect(await factLines(page, "overview-fact-rfis")).toEqual(expectedByStatus(rows("rfis")))
  expect(await factLines(page, "overview-fact-punch")).toEqual(expectedByStatus(rows("punch_list")))
  expect(await factLines(page, "overview-fact-submittals")).toEqual(expectedByStatus(rows("submittals")))
}

async function expectNoSecret(page: Page, world: World) {
  expect(world.secretRequests, "a request named the project the person may not read").toEqual([])
  await expect(page.locator("body")).not.toContainText(P_SECRET.name)
  await expect(page.locator("body")).not.toContainText("SECRET")
  expect(await switcherNames(page)).toEqual([P1.name, P2.name])
}

test("manager: offline, every dashboard / report / analysis figure is the seeded data's or the server's own, and the unreadable project never appears", async ({ page, context }) => {
  const consoleWatch = watchConsole(page)
  const world = createWorld({ role: "manager" })
  const prepared = await prepareLaptop(page, context, world)

  await test.step("online: the dashboard, a report, exceptions and project 360 fetch the server's figures once and keep them", async () => {
    await page.goto(`/local/dashboard?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-dashboard-figures").locator("[data-state=snapshot]")).toBeVisible()
    await page.goto(`/local/reports?report=project-status&projectId=${P1.id}`)
    await expect(page.getByTestId("overview-report").locator("[data-state=snapshot]")).toBeVisible()
    await page.goto(`/local/analysis/exceptions?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-exception-check")).toHaveCount(3)
    await page.goto(`/local/analysis/project-360?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-project360-margin").locator("[data-state=snapshot]")).toBeVisible()
  })

  await goOffline(context, prepared)

  await test.step("offline: the dashboard shows the person's two projects, fully copied, and the non-money facts counted from the rows", async () => {
    await page.goto(`/dashboard?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-dashboard")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${P1.name}`)
    await expect(page.getByTestId("overview-dashboard-sync")).toHaveText("Working on this laptop; will sync when connected")
    const projects = page.getByTestId("overview-dashboard-project")
    await expect(projects).toHaveCount(2)
    await expect(projects.nth(0)).toContainText(`${P1.name} · fully copied`)
    await expect(projects.nth(1)).toContainText(`${P2.name} · fully copied`)
    await expect(page.getByTestId("overview-dashboard-waiting")).toHaveText(/Everything you did on this laptop has reached the server\./)
    await expectDashboardFacts(page, world, P1.id)
    await noCrashText(page)
  })

  await test.step("offline: the server's project figures are the server's own, exactly, labelled as kept on this laptop", async () => {
    const f = SERVER_FIGURES[P1.id]!
    await expect(page.getByTestId("overview-dashboard-asof")).toHaveText(/^As of .+, from this laptop$/)
    const shown = await dashboardFigures(page)
    expect(shown["Progress"]).toBe(percent(f.progressPercent))
    expect(shown["% complete by BOQ value"]).toBe(percent(f.percentByValue))
    expect(shown["Contract value"]).toContain(money(f.contractValue))
    expect(shown["Budget"]).toContain(money(f.budget))
    expect(shown["Spent"]).toContain(money(f.expenses))
    expect(shown["Delayed tasks"]).toBe(String(f.delayedTaskCount))
    expect(shown["Permits expiring"]).toBe(String(f.permitsExpiringCount))
  })

  await test.step("offline: switching project in the header recounts for the other project", async () => {
    await page.getByTestId("local-shell-project").selectOption(P2.id)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${P2.name}`)
    await expectDashboardFacts(page, world, P2.id)
    // the second project's server figures were never fetched on this laptop: said plainly, no number made up
    await expect(page.getByTestId("overview-dashboard-figures").locator("[data-state=none]")).toContainText("They will be shown here once the laptop is connected.")
  })

  await test.step("offline: the report kept on this laptop shows the server's rows; the over-budget project is the one the server said", async () => {
    await page.goto(`/reports?report=project-status&projectId=${P1.id}`)
    await expect(page.getByTestId("overview-report-asof")).toHaveText(/^As of .+, from this laptop$/)
    const rows = page.getByTestId("overview-report").getByTestId("overview-body-row")
    await expect(rows).toHaveCount(world.projects.length)
    const over = world.projects.filter((p) => SERVER_FIGURES[p.id]!.expenses > SERVER_FIGURES[p.id]!.budget)
    expect(over.map((p) => p.name)).toEqual([P1.name])
    await expect(rows.nth(0)).toContainText(P1.name)
    await expect(rows.nth(0)).toContainText(SERVER_FIGURES[P1.id]!.budget.toLocaleString("en-US"))
    await expect(rows.nth(0)).toContainText("Yes")
    await expect(rows.nth(1)).toContainText(P2.name)
    await expect(rows.nth(1)).toContainText("No")
    // a report never fetched on this laptop says so instead of showing anything
    await page.goto(`/reports?report=kpi&projectId=${P1.id}`)
    await expect(page.getByTestId("overview-report-none")).toHaveText("This report has not been saved on this laptop yet. It will be fetched, and can be exported, once the laptop is connected.")
  })

  await test.step("offline: exceptions are the server's checks, verdicts and counts unchanged", async () => {
    await page.goto(`/analysis/exceptions?projectId=${P1.id}`)
    const checks = page.getByTestId("overview-exception-check")
    const expected = exceptionsBody(P1.id).checks
    await expect(checks).toHaveCount(expected.length)
    for (const [i, c] of expected.entries()) {
      await expect(checks.nth(i)).toHaveAttribute("data-flagged", c.flagged ? "1" : "0")
      await expect(checks.nth(i)).toContainText(`${c.item}. ${c.title} · ${c.flagged ? `${c.count} flagged` : "clear"}`)
      for (const r of c.records) await expect(checks.nth(i)).toContainText(r.detail)
    }
  })

  await test.step("offline: project 360 shows the server's margin and counts change orders, milestones and claims by status from the rows", async () => {
    await page.goto(`/analysis/project-360?projectId=${P1.id}`)
    const f = SERVER_FIGURES[P1.id]!
    const margin = page.getByTestId("overview-project360-margin")
    await expect(margin).toContainText((f.contractValue - f.expenses).toLocaleString("en-US"))
    expect(await factLines(page, "overview-project360-change-orders")).toEqual(expectedByStatus(world.current(P1.id, "change_orders")))
    expect(await factLines(page, "overview-project360-milestones")).toEqual(expectedByStatus(world.current(P1.id, "milestones")))
    expect(await factLines(page, "overview-project360-claims")).toEqual(expectedByStatus(world.current(P1.id, "progress_claims")))
    // amounts are never added up on the laptop: the change orders' total (63,700.00) appears nowhere
    await expect(page.locator("main")).not.toContainText("63,700")
  })

  await test.step("offline: a deep link to the project the person cannot read opens their own project instead, and nothing of it is anywhere", async () => {
    await page.goto(`/dashboard?projectId=${P_SECRET.id}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`^Dashboard / (${P1.name}|${P2.name})$`))
    await expectNoSecret(page, world)
  })

  await test.step("our server down (online browser): the same screens open from the laptop with the same figures", async () => {
    await goOnline(context, prepared)
    serverDown(prepared)
    await page.goto(`/local/dashboard?projectId=${P1.id}`)
    await expectDashboardFacts(page, world, P1.id)
    await expect(page.getByTestId("overview-dashboard-asof")).toHaveText(/^As of .+, from this laptop$/)
    await expect(page.getByTestId("overview-dashboard-refresh")).toHaveText("The server is not answering just now, so these are the figures last saved on this laptop.")
    await noCrashText(page)
  })

  await expectNoSecret(page, world)
  consoleWatch.check("on the overview screens")
})

test("client viewer: offline, money is absent (never shown as 'Not set'), counts are the same, and no money reaches the laptop's rows", async ({ page, context }) => {
  const consoleWatch = watchConsole(page)
  const world = createWorld({ role: "client_viewer" })
  const prepared = await prepareLaptop(page, context, world, "overview-viewer@example.invalid")

  await test.step("online: the dashboard and project 360 keep the server's REDACTED answer", async () => {
    await page.goto(`/local/dashboard?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-dashboard-figures").locator("[data-state=snapshot]")).toBeVisible()
    await page.goto(`/local/analysis/project-360?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-project360-margin").locator("[data-state=snapshot]")).toBeVisible()
  })

  await goOffline(context, prepared)

  await test.step("offline: the dashboard shows the non-money figures and NO money row at all, with a plain reason", async () => {
    await page.goto(`/dashboard?projectId=${P1.id}`)
    await expectDashboardFacts(page, world, P1.id)
    const f = SERVER_FIGURES[P1.id]!
    const shown = await dashboardFigures(page)
    expect(shown["Progress"]).toBe(percent(f.progressPercent))
    expect(shown["Delayed tasks"]).toBe(String(f.delayedTaskCount))
    expect(shown["Permits expiring"]).toBe(String(f.permitsExpiringCount))
    for (const label of ["Contract value", "Budget", "Spent", "% complete by BOQ value"]) expect(Object.keys(shown), `${label} is shown to a client viewer`).not.toContain(label)
    await expect(page.getByTestId("overview-dashboard-money-hidden")).toHaveText("Money figures are shown to managers and above.")
    const card = page.getByTestId("overview-dashboard-figures")
    for (const n of [f.contractValue, f.budget, f.expenses]) await expect(card).not.toContainText(money(n))
    await expect(card).not.toContainText("Not set")
  })

  await test.step("offline: project 360 shows the server's redacted margin (dashes), never a figure", async () => {
    await page.goto(`/analysis/project-360?projectId=${P1.id}`)
    const margin = page.getByTestId("overview-project360-margin")
    await expect(margin.locator("[data-state=snapshot]")).toBeVisible()
    const f = SERVER_FIGURES[P1.id]!
    for (const n of [f.contractValue, f.expenses, f.contractValue - f.expenses]) await expect(margin).not.toContainText(n.toLocaleString("en-US"))
  })

  await test.step("the BOQ lines on the laptop carry no rate or amount (the server hid them; the laptop never had them)", async () => {
    // Every record of every store is read (a local-db record is {id: "<kind>:<id>", type: <kind>, orgId, projectId, data}).
    const lines = await page.evaluate(
      ({ db, projectId }) =>
        new Promise<Array<{ id: string; keys: string[] }>>((resolve) => {
          const open = indexedDB.open(db)
          open.onsuccess = () => {
            const names = [...open.result.objectStoreNames]
            const out: Array<{ id: string; keys: string[] }> = []
            const tx = open.result.transaction(names, "readonly")
            for (const name of names) {
              if (name === "meta") continue
              const all = tx.objectStore(name).getAll()
              all.onsuccess = () => {
                for (const rec of all.result as Array<{ type?: string; projectId?: string; data?: Record<string, unknown> }>) {
                  if (rec?.type === "boq_lines" && rec.projectId === projectId && rec.data) out.push({ id: String(rec.data.id), keys: Object.keys(rec.data) })
                }
              }
            }
            tx.oncomplete = () => { open.result.close(); resolve(out) }
          }
          open.onerror = () => resolve([])
        }),
      { db: `projexa-local:${prepared.session.userId}`, projectId: P1.id }
    )
    // both lines ARE on the laptop (so this checks something), and neither carries a money field
    expect(lines.map((l) => l.id).sort()).toEqual(world.current(P1.id, "boq_lines").map((r) => r.id).sort())
    for (const l of lines) expect(l.keys, `BOQ line ${l.id} on the laptop`).not.toEqual(expect.arrayContaining(["rate"]))
    for (const l of lines) expect(l.keys, `BOQ line ${l.id} on the laptop`).not.toEqual(expect.arrayContaining(["amount"]))
    expect(lines[0]!.keys).toEqual(expect.arrayContaining(["description", "quantity"]))
  })

  await expectNoSecret(page, world)
  consoleWatch.check("for a client viewer")
})
