import { test, expect, type Page } from "@playwright/test"
import { factLines, goOffline, goOnline, noCrashText, personMeta, prepareLaptop, watchConsole } from "./support/lf-overview-harness"
import { P1, createWorld, dayFromToday, type Row, type World } from "./support/lf-overview-stub"

// LOCAL-FIRST overview (package lf-e10c): the dashboard's figures FOLLOW the data. A colleague's change that the sync service's /changes
// feed brings to the laptop shows on the open dashboard without a reload (the person comes back to the tab, or the laptop comes back
// online), and an edit made offline on another screen of the shell is counted as waiting, then cleared once it is sent. Real Chromium,
// production build, everything answered in the browser (e2e/support/lf-overview-stub.ts). See lf-overview-figures.spec.ts for the rest.

test.use({ timezoneId: "UTC" })

const notFinished = (rows: Row[]) => rows.filter((t) => t.is_archived !== true && Number(t.completion_percentage) < 100)
function expectedTaskLines(rows: Row[]) {
  const today = dayFromToday(0)
  const weekEnd = dayFromToday(6)
  const open = notFinished(rows)
  const due = (t: Row) => (typeof t.due_date === "string" ? t.due_date : "")
  return [`Not finished: ${open.length}`, `Due this week: ${open.filter((t) => due(t) && due(t) >= today && due(t) <= weekEnd).length}`, `Overdue: ${open.filter((t) => due(t) && due(t) < today).length}`]
}
const openRfis = (w: World) => w.current(P1.id, "rfis").filter((r) => r.status === "open").length

/** Marks the document; a reload (or any full navigation) loses the mark. */
const markDocument = (page: Page) => page.evaluate(() => { (window as unknown as { __ovSameDocument?: boolean }).__ovSameDocument = true })
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { __ovSameDocument?: boolean }).__ovSameDocument === true)

test("a colleague's change brought by /changes updates the open dashboard without a reload; an offline edit on another screen is counted as waiting until sent", async ({ page, context }) => {
  const consoleWatch = watchConsole(page)
  const world = createWorld({ role: "manager" })
  const prepared = await prepareLaptop(page, context, world)

  await page.goto(`/local/dashboard?projectId=${P1.id}`)
  await expect(page.getByTestId("overview-fact-tasks").locator("[data-state=local]")).toBeVisible()
  expect(await factLines(page, "overview-fact-tasks")).toEqual(expectedTaskLines(world.current(P1.id, "tasks")))
  await markDocument(page)

  await test.step("online, the person comes back to the tab: a new task, a finished one and a new RFI arrive through /changes and are counted", async () => {
    world.serverWrite(P1.id, "tasks", { id: "t9", title: "Ceiling grid, level 2", completion_percentage: 0, due_date: dayFromToday(1), is_archived: false })
    world.serverWrite(P1.id, "tasks", { id: "t3", title: "Shoring removal", completion_percentage: 100, due_date: dayFromToday(-3), is_archived: false })
    world.serverWrite(P1.id, "rfis", { id: "r7", number: 7, subject: "Sprinkler drops", status: "open" })
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect.poll(() => factLines(page, "overview-fact-tasks"), { timeout: 30_000, message: "the dashboard never showed the tasks /changes brought" }).toEqual(expectedTaskLines(world.current(P1.id, "tasks")))
    await expect(page.getByTestId("overview-fact-rfis").locator("li").first()).toHaveText(`open: ${openRfis(world)}`)
    expect(await sameDocument(page), "the page was reloaded").toBe(true)
    // the rows really are on the laptop now, not only on the screen
    await expect.poll(() => page.evaluate(async ({ db }) => {
      const open = indexedDB.open(db)
      const handle = await new Promise<IDBDatabase>((r) => { open.onsuccess = () => r(open.result) })
      const names = [...handle.objectStoreNames].filter((n) => n !== "meta")
      const found: string[] = []
      await new Promise<void>((r) => {
        const tx = handle.transaction(names, "readonly")
        for (const n of names) { const all = tx.objectStore(n).getAll(); all.onsuccess = () => { for (const rec of all.result as Array<{ id?: string }>) if (rec.id === "tasks:t9" || rec.id === "rfis:r7") found.push(rec.id) } }
        tx.oncomplete = () => r()
      })
      handle.close()
      return found.sort()
    }, { db: `projexa-local:${prepared.session.userId}` })).toEqual(["rfis:r7", "tasks:t9"])
  })

  await test.step("a change made while the laptop was offline arrives when it is back online, still without a reload", async () => {
    await goOffline(context, prepared)
    world.serverWrite(P1.id, "tasks", { id: "t10", title: "Overdue survey", completion_percentage: 5, due_date: dayFromToday(-2), is_archived: false })
    await expect(page.getByTestId("overview-dashboard-sync")).toHaveText("Working on this laptop; will sync when connected")
    await goOnline(context, prepared)
    await expect.poll(() => factLines(page, "overview-fact-tasks"), { timeout: 30_000, message: "the change made while offline never reached the open dashboard" }).toEqual(expectedTaskLines(world.current(P1.id, "tasks")))
    expect(await sameDocument(page), "the page was reloaded").toBe(true)
  })

  await test.step("offline, a BOQ edit on the Scope screen is counted on the dashboard as waiting", async () => {
    await goOffline(context, prepared)
    await page.goto(`/local/scope/ov-boq-1?projectId=${P1.id}`)
    await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local")
    const input = page.getByTestId("boq-line-category-input").first()
    await input.click()
    await page.keyboard.type("Concrete")
    await page.getByTestId("boq-line-save").first().click()
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync")
    expect(await personMeta(page, prepared.session.userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: "ov-line-1", patch: { category: "Concrete" } })])
    // to the dashboard through the shell's own header link (no page load)
    await markDocument(page)
    await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Dashboard" }).click()
    await expect(page.getByTestId("overview-dashboard-waiting").locator("[data-state=waiting]")).toHaveText(/^1 change is saved here and will be sent when the laptop is connected\. Nothing is lost\./)
    expect(world.patches).toEqual([])
    await noCrashText(page)
  })

  await test.step("back online: the edit is sent exactly once and the dashboard says everything reached the server, without a reload", async () => {
    await goOnline(context, prepared)
    await expect.poll(() => world.patches.length, { timeout: 90_000, message: "the offline edit was never sent" }).toBe(1)
    expect(world.patches[0]).toEqual({ path: "/api/scope/line-items/ov-line-1", body: { category: "Concrete", expectedCategory: null } })
    await expect(page.getByTestId("overview-dashboard-waiting").locator("[data-state=none]")).toHaveText("Everything you did on this laptop has reached the server.", { timeout: 30_000 })
    expect(await sameDocument(page), "the page was reloaded").toBe(true)
    await page.waitForTimeout(1000)
    expect(world.patches, "the edit was sent more than once").toHaveLength(1)
  })

  consoleWatch.check("while the dashboard followed the data")
})
