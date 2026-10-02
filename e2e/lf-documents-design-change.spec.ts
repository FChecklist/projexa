import { test, expect, type Page } from "@playwright/test"
import { expectCleanConsole, goOffline, goOnline, noCrash, openLocal, prepareLaptop } from "./support/lf-documents-prepare"
import { PROJECT_ID, PROJECT_NAME, TODAY, readOutbox } from "./support/lf-documents-stub"

// lf-e10b. The DESIGN AND CHANGE cluster (src/lib/local-first/shell/clusters/design-change.ts) in a real Chromium: change orders and the
// design studio's timesheet open from the laptop's own database with the network OFF, show the real values, hide money from a role
// below the money rank, and every write (create_change_order, submit_change_order_for_approval, record_timesheet, submit_timesheet) is
// kept on the laptop, survives a reload and is sent EXACTLY ONCE, with the real AI work link registry's parameter names, when the
// connection is back. Same set-up as e2e/lf-documents-docs.spec.ts.

test.describe.configure({ mode: "serial" })

/** Types into a controlled input with real keystrokes (the keystroke crash class of lf-e8). */
async function typeInto(page: Page, testId: string, text: string) {
  await page.getByTestId(testId).click()
  await page.keyboard.type(text)
}

test("change orders and the timesheet open offline with their real values; money shows for a manager", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "manager")
  await goOffline(context, p)

  await test.step("change orders list: numbers, titles, signed money, schedule impact, status", async () => {
    await openLocal(page, "/change-orders")
    await expect(page.getByTestId("co-list")).toHaveAttribute("data-state", "local")
    await expect(page.getByTestId("co-list").locator("h1")).toHaveText(`Change Orders / ${PROJECT_NAME}`)
    const co3 = page.locator('[data-testid="co-row"][data-co-id="lf-co-3"]')
    await expect(co3).toContainText("CO-3")
    await expect(co3).toContainText("Extra glazing to lobby")
    await expect(co3.getByTestId("co-cost")).toContainText("18,500")
    await expect(co3).toContainText("+4d")
    await expect(co3.getByTestId("co-status")).toHaveText("draft")
    const co2 = page.locator('[data-testid="co-row"][data-co-id="lf-co-2"]')
    await expect(co2.getByTestId("co-cost")).toContainText("-2,400")
    await expect(co2).toContainText("-2d")
    // newest number first
    await expect(page.getByTestId("co-row")).toHaveCount(2)
    await expect(page.getByTestId("co-row").first()).toHaveAttribute("data-co-id", "lf-co-3")
    await noCrash(page)
  })

  await test.step("one change order: facts and reason", async () => {
    await openLocal(page, "/change-orders/lf-co-3")
    await expect(page.getByTestId("co-title")).toHaveText("CO-3 Extra glazing to lobby")
    await expect(page.getByTestId("fact-cost-impact")).toContainText("18,500")
    await expect(page.getByTestId("fact-trade")).toHaveText("Glazing")
    await expect(page.getByTestId("co-reason")).toHaveText("Client asked for a double-height curtain wall.")
    await expect(page.getByTestId("co-send-open")).toBeVisible()
  })

  await test.step("my timesheet for today: MY entry (written by the server under my VERIDIAN id), not a colleague's", async () => {
    await openLocal(page, "/design-studio")
    await expect(page.getByTestId("ds-timesheet")).toHaveAttribute("data-state", "local")
    await expect(page.getByTestId("ds-row"), "my own synced entry is not shown as mine").toHaveCount(1)
    const mine = page.locator('[data-testid="ds-row"][data-entry-id="lf-ts-1"]')
    await expect(mine).toContainText("#7 Lobby concept design")
    await expect(mine).toContainText("3.50")
    await expect(page.locator('[data-testid="ds-row"][data-entry-id="lf-ts-2"]')).toHaveCount(0)
    await expect(page.getByTestId("ds-day-total")).toHaveText("Total today: 3.50 h")
    await noCrash(page)
  })

  await test.step("design review: the colleague's submitted day; my own day is never mine to approve", async () => {
    await openLocal(page, "/design-studio/review")
    await expect(page.getByTestId("ds-review")).toHaveAttribute("data-state", "local")
    await expect(page.getByTestId("ds-review-group")).toHaveCount(1)
    await expect(page.getByTestId("ds-review-group")).toContainText("6.00")
  })

  await test.step("cost analysis needs the server: a calm sentence offline", async () => {
    await openLocal(page, "/design-studio/cost-analysis")
    await expect(page.getByTestId("dc-server-only")).toBeVisible()
    await noCrash(page)
  })

  expect(await readOutbox(page, p.session.userId)).toEqual([])
  await goOnline(context, p)
  expectCleanConsole(p.console)
})

test("a change order raised offline by typing waits, survives a reload, and is sent once as create_change_order; sending one for approval too", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "manager")
  await goOffline(context, p)

  await test.step("offline: New Change Order, typed key by key", async () => {
    await openLocal(page, "/change-orders/new")
    await expect(page.getByTestId("co-new-screen")).toHaveAttribute("data-state", "ready")
    await typeInto(page, "co-new-title", "Upgrade lobby flooring to marble")
    await typeInto(page, "co-new-reason", "Client upgrade, façade-matched stone.")
    await typeInto(page, "co-new-cost", "12500.50")
    await typeInto(page, "co-new-days", "6")
    await expect(page.getByTestId("co-new-title")).toHaveValue("Upgrade lobby flooring to marble")
    await page.getByTestId("co-new-save").click()
    await expect(page.getByTestId("co-object")).toHaveAttribute("data-state", "local")
    await expect(page.getByTestId("co-title")).toContainText("Upgrade lobby flooring to marble")
    await expect(page.getByTestId("dc-waiting")).toHaveText("Waiting to be sent")
    await expect(page.getByTestId("co-status")).toHaveText("Not yet accepted by the server")
  })

  await test.step("offline: send CO-3 for approval (a signer typed in)", async () => {
    await openLocal(page, "/change-orders/lf-co-3")
    await page.getByTestId("co-send-open").click()
    await typeInto(page, "co-signer-name", "Omar Saeed")
    await typeInto(page, "co-signer-email", "omar.saeed@example.invalid")
    await page.getByTestId("co-send").click()
    await expect(page.getByTestId("co-approval-waiting")).toBeVisible()
    await expect(page.getByTestId("co-status")).toHaveText("draft") // the status stays the server's
  })

  await test.step("offline: a reload keeps both", async () => {
    await page.reload()
    await expect(page.getByTestId("co-approval-waiting")).toBeVisible()
    await openLocal(page, "/change-orders")
    await expect(page.getByTestId("co-row")).toHaveCount(3)
    await expect(page.getByTestId("co-row").first()).toContainText("Upgrade lobby flooring to marble")
    await expect(page.getByTestId("co-row").first()).toContainText("Waiting to be sent")
    expect(p.sync.pushed).toEqual([])
  })

  await test.step("online: each sent exactly once, in the registry's parameter names", async () => {
    await goOnline(context, p)
    await expect.poll(() => p.sync.pushed.length, { timeout: 90_000, message: "the offline change orders were never sent" }).toBe(2)
    const create = p.sync.pushed.find((o) => o.function_id === "create_change_order")!
    expect(create.params).toEqual({
      projectId: PROJECT_ID, title: "Upgrade lobby flooring to marble", reason: "Client upgrade, façade-matched stone.", costImpact: 12500.5, scheduleImpactDays: 6,
    })
    expect(create.record).toBeUndefined()
    const submit = p.sync.pushed.find((o) => o.function_id === "submit_change_order_for_approval")!
    expect(submit.params).toEqual({ projectId: PROJECT_ID, changeOrderId: "lf-co-3", signers: [{ name: "Omar Saeed", email: "omar.saeed@example.invalid" }] })
    expect(submit.record).toEqual({ kind: "change_orders", id: "lf-co-3", base_version: 2 })
    await expect.poll(() => readOutbox(page, p.session.userId)).toEqual([])
    await page.waitForTimeout(3_000)
    expect(p.sync.pushed).toHaveLength(2)
  })
  expectCleanConsole(p.console)
})

test("a member below the money rank: cost is hidden everywhere and a new change order sends NO cost field", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "member")
  await goOffline(context, p)

  await openLocal(page, "/change-orders")
  await expect(page.locator('[data-testid="co-row"][data-co-id="lf-co-3"]').getByTestId("co-cost")).toHaveText("Hidden for your role")
  await expect(page.getByTestId("co-list")).not.toContainText("18,500")
  await openLocal(page, "/change-orders/lf-co-3")
  await expect(page.getByTestId("fact-cost-impact")).toHaveText("Hidden for your role")
  // sending for approval is rank 3: a member is told so, not offered it
  await expect(page.getByTestId("co-send-open")).toHaveCount(0)
  await expect(page.getByTestId("co-approval-role")).toBeVisible()

  await openLocal(page, "/change-orders/new")
  // wait for the screen itself, or "no cost field" would be true of the loading line
  await expect(page.getByTestId("co-new-screen")).toHaveAttribute("data-state", "ready")
  await expect(page.getByTestId("co-new-title")).toBeVisible()
  await expect(page.getByTestId("co-new-cost"), "a role that may not see money was offered a money field").toHaveCount(0)
  await expect(page.getByTestId("co-new-cost-hidden")).toBeVisible()
  await typeInto(page, "co-new-title", "Extra power points in lobby")
  await typeInto(page, "co-new-days", "2")
  await page.getByTestId("co-new-save").click()
  await expect(page.getByTestId("co-title")).toContainText("Extra power points in lobby")

  await goOnline(context, p)
  await expect.poll(() => p.sync.pushed.length, { timeout: 90_000 }).toBe(1)
  expect(p.sync.pushed[0].function_id).toBe("create_change_order")
  expect(p.sync.pushed[0].params, "a write was sent for a field hidden from this role").toEqual({ projectId: PROJECT_ID, title: "Extra power points in lobby", scheduleImpactDays: 2 })
  expectCleanConsole(p.console)
})

test("design studio: a time entry logged offline (New Timesheet Entry) waits, survives a reload, and is sent once as record_timesheet", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "member")
  await goOffline(context, p)

  await test.step("offline: the create screen, task chosen, hours typed", async () => {
    await openLocal(page, "/design-studio/timesheets/new")
    await expect(page.getByTestId("ds-entry-new")).toHaveAttribute("data-state", "ready")
    await page.getByTestId("ds-new-task").selectOption("lf-task-8")
    await typeInto(page, "ds-new-hours", "2.25")
    await expect(page.getByTestId("ds-new-save")).toHaveText("Save")
    await page.getByTestId("ds-new-save").click()
    await expect(page.getByTestId("ds-timesheet")).toHaveAttribute("data-state", "local")
    const added = page.getByTestId("ds-row").filter({ hasText: "#8 Joinery shop drawings" })
    await expect(added).toContainText("2.25")
    await expect(added).toContainText("Waiting to be sent")
    // my synced 3.50 h and the new 2.25 h
    await expect(page.getByTestId("ds-day-total")).toHaveText("Total today: 5.75 h")
  })

  await test.step("the 24-hour rule counts MY hours of the day, synced ones included", async () => {
    await openLocal(page, "/design-studio/timesheets/new")
    await page.getByTestId("ds-new-task").selectOption("lf-task-7")
    await typeInto(page, "ds-new-hours", "19")
    await page.getByTestId("ds-new-save").click()
    await expect(page.getByTestId("ds-new-error-hours"), "19 h on top of 5.75 h was accepted").toBeVisible()
  })

  await test.step("offline: a reload keeps it", async () => {
    await openLocal(page, "/design-studio")
    await page.reload()
    await expect(page.getByTestId("ds-row").filter({ hasText: "#8 Joinery shop drawings" })).toContainText("2.25")
  })

  await test.step("online: sent once, with the registry's names", async () => {
    await goOnline(context, p)
    await expect.poll(() => p.sync.pushed.length, { timeout: 90_000, message: "the offline time entry was never sent" }).toBe(1)
    expect(p.sync.pushed[0].function_id).toBe("record_timesheet")
    expect(p.sync.pushed[0].params).toEqual({ projectId: PROJECT_ID, issueId: "lf-task-8", hours: 2.25, spentOn: TODAY, activityType: "Concept" })
    await expect.poll(() => readOutbox(page, p.session.userId)).toEqual([])
    await page.waitForTimeout(3_000)
    expect(p.sync.pushed).toHaveLength(1)
  })
  expectCleanConsole(p.console)
})
