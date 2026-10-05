import { test, expect, type Browser, type Page } from "@playwright/test"
import { PROJECT_ID, newServer, offline, online, openLocal, prepareLaptop, readLocalRow, retype, signInOnEvery, type ConflictServer, type Laptop } from "./support/lf-conflict-stub"

// AUDIT-100 B7 (an edit made on one laptop lands on a colleague's laptop) and B28 (back online, sync resumes WITHOUT a refresh), in a real
// Chromium. TWO people on TWO laptops (two browser contexts, each with its own IndexedDB and service worker) share one versioned sync
// service (e2e/support/lf-conflict-stub.ts, the real service's shapes: /heads, /changes, /pull by ids, /push). Laptop B is OPEN AND IDLE on
// the permits list -- nobody touches it, it is never reloaded -- while laptop A (and a colleague elsewhere) change permits. B must show
// every change BY ITSELF within the documented interval (src/lib/local-first/peer/scheduler.ts header: the next auto-sync timer run, 5
// minutes after a quiet run; at once when its network comes back). B's clock is Playwright's fake clock, so "5 minutes later" is
// `clock.fastForward("05:00")`, never a five-minute sleep.
//
// What it caught (seen failing on the old code, see the PR): B showed none of it on screen (no redraw after a background sync); the
// second and later changes never reached B's own database at all (the open project was not "open" to the auto-sync unless picked in the
// switcher, so it was read at most hourly); and B's `online` trigger right after a quiet run was dropped (B28).
// Every outcome is re-read from the server's record AND from each laptop's own database, never taken from a message.

test.describe.configure({ mode: "serial" })

const PERMIT = "lf-permit-dm"
const NEW_PERMIT = "lf-permit-crane"

async function twoPeople(browser: Browser, server: ConflictServer): Promise<{ a: Laptop; b: Laptop; userA: string; userB: string; close: () => Promise<void> }> {
  const base = test.info().project.use.baseURL!
  const ctxA = await browser.newContext({ baseURL: base, serviceWorkers: "allow" })
  const ctxB = await browser.newContext({ baseURL: base, serviceWorkers: "allow" })
  const close = async () => { await ctxA.close().catch(() => {}); await ctxB.close().catch(() => {}) }
  try {
    const whoA = await signInOnEvery("lf-b7-site-engineer@example.invalid", [ctxA])
    const whoB = await signInOnEvery("lf-b7-project-manager@example.invalid", [ctxB])
    const a = await prepareLaptop("laptop A", ctxA, whoA, "member", server)
    const b = await prepareLaptop("laptop B", ctxB, whoB, "manager", server)
    return { a, b, userA: whoA.userId, userB: whoB.userId, close }
  } catch (err) {
    await close()
    throw err
  }
}

/** A colleague elsewhere (the web app) creates a permit: the server stores it and its change feed gets an `I` entry, as the real one does. */
function colleagueCreatesPermit(server: ConflictServer, id: string, name: string) {
  const at = new Date().toISOString()
  server.rows.set(`documents:${id}`, {
    kind: "documents", id, version: 1, updated_at: at,
    data: {
      id, name, category: "permit", file_type: "application/pdf", file_size: 80_000, expiry_date: "2027-03-31", version_number: 1, is_latest_version: true,
      created_at: at, linked_entity_type: "project", linked_entity_id: PROJECT_ID, metadata: { permitNumber: "CR-77", permitAuthority: "Civil Defence", issueDate: "2026-10-01" },
    },
  })
  server.feed.push({ seq: (server.feed.at(-1)?.seq ?? 0) + 1, kind: "documents", id, version: 1, op: "I" })
}

/** Laptop A renames the permit through its own screen and waits until the server applied it. */
async function aRenames(a: Laptop, server: ConflictServer, name: string) {
  const before = server.received.filter((r) => r.laptop === a.name && r.status === "applied").length
  await openLocal(a, `/permits/${PERMIT}`)
  await a.page.getByTestId("doc-edit-open").click()
  await retype(a.page, "doc-edit-name", name)
  await a.page.getByTestId("doc-edit-save").click()
  await expect.poll(() => server.received.filter((r) => r.laptop === a.name && r.status === "applied").length, { timeout: 90_000, message: "laptop A never sent its rename" }).toBe(before + 1)
  expect(server.row("documents", PERMIT).data.name).toBe(name)
}

const markDocument = (page: Page) => page.evaluate(() => { (window as unknown as { __b7Same?: boolean }).__b7Same = true })
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { __b7Same?: boolean }).__b7Same === true)
const listRow = (b: Laptop, id: string) => b.page.locator(`[data-testid="permits-list-row"][data-doc-id="${id}"]`)

test("B7 + B28: an idle colleague laptop shows every later change by itself within the interval, and catches up by itself when its network comes back", async ({ browser }) => {
  test.slow()
  const server = newServer()
  const { a, b, userA, userB, close } = await twoPeople(browser, server)
  try {
    const heads: number[] = []
    b.page.on("requestfinished", (r) => { if (r.url().endsWith("/projexa-sync/heads")) heads.push(Date.now()) })
    await b.page.clock.install() // time flows as usual; fastForward jumps it the way an idle laptop's minutes pass

    await test.step("laptop B opens the permits list and is left alone (its auto-sync's first round runs on open)", async () => {
      await openLocal(b, "/permits")
      await expect(b.page.getByTestId("permits-list")).toHaveAttribute("data-state", "local")
      await expect(b.page.getByTestId("permits-list-row")).toHaveCount(2)
      await expect(listRow(b, PERMIT)).toContainText("Building permit - podium")
      await expect.poll(() => heads.length, { timeout: 60_000, message: "laptop B's auto-sync never ran on open" }).toBeGreaterThan(0)
      await b.page.waitForTimeout(1500) // that first round has finished (nothing moved yet): what follows is a LATER change
      await markDocument(b.page)
    })

    await test.step("B7: laptop A renames the permit online; B shows it by its next auto-sync round, without a reload", async () => {
      await aRenames(a, server, "Building permit - podium and tower")
      await b.page.clock.fastForward("05:00")
      await expect.poll(() => readLocalRow(b.page, userB, "documents", PERMIT), { timeout: 30_000, message: "laptop B's own copy never got laptop A's rename" })
        .toMatchObject({ serverVersion: 4, data: { name: "Building permit - podium and tower" } })
      await expect(listRow(b, PERMIT), "laptop B's open screen never showed the rename").toContainText("Building permit - podium and tower")
      expect(await sameDocument(b.page), "laptop B was reloaded").toBe(true)
    })

    await test.step("B7: a LATER change -- a colleague's new permit -- also arrives by itself on the next round", async () => {
      colleagueCreatesPermit(server, NEW_PERMIT, "Tower crane permit")
      await b.page.clock.fastForward("05:00")
      await expect.poll(() => readLocalRow(b.page, userB, "documents", NEW_PERMIT), { timeout: 30_000, message: "laptop B never got the later new permit" })
        .toMatchObject({ serverVersion: 1, data: { name: "Tower crane permit" } })
      await expect(b.page.getByTestId("permits-list-row"), "laptop B's open screen never showed the new permit").toHaveCount(3)
      await expect(listRow(b, NEW_PERMIT)).toContainText("Tower crane permit")
      expect(await sameDocument(b.page), "laptop B was reloaded").toBe(true)
    })

    await test.step("B28: B's network is cut; A renames again; B's timer round passes while it is offline; the network comes back -> B catches up by itself", async () => {
      await offline(b)
      await aRenames(a, server, "Building permit - podium, tower and roof")
      const headsBefore = heads.length
      await b.page.clock.fastForward("05:00") // B's round comes while it is offline: nothing can be asked
      await b.page.waitForTimeout(500)
      expect(heads.length, "laptop B reached the server while offline").toBe(headsBefore)
      expect((await readLocalRow(b.page, userB, "documents", PERMIT))?.data.name, "precondition: B cannot have the change yet").toBe("Building permit - podium and tower")
      await online(b) // no reload, no click, no fastForward: the `online` event alone
      await expect.poll(() => readLocalRow(b.page, userB, "documents", PERMIT), { timeout: 60_000, message: "back online, laptop B never caught up by itself" })
        .toMatchObject({ serverVersion: 5, data: { name: "Building permit - podium, tower and roof" } })
      await expect(listRow(b, PERMIT), "back online, laptop B's open screen never showed the change").toContainText("Building permit - podium, tower and roof")
      expect(await sameDocument(b.page), "laptop B was reloaded").toBe(true)
    })

    await test.step("both laptops' own databases and the server agree", async () => {
      expect(server.row("documents", PERMIT)).toMatchObject({ version: 5, data: { name: "Building permit - podium, tower and roof" } })
      for (const [l, user] of [[a, userA], [b, userB]] as const) {
        await expect.poll(() => readLocalRow(l.page, user, "documents", PERMIT), { timeout: 60_000, message: `${l.name}'s own copy disagrees with the server` })
          .toMatchObject({ serverVersion: 5, data: { name: "Building permit - podium, tower and roof" } })
        expect((await readLocalRow(l.page, user, "documents", PERMIT))?.dirty ?? null).toBeNull()
      }
      expect(await readLocalRow(b.page, userB, "documents", NEW_PERMIT)).toMatchObject({ serverVersion: 1, data: { name: "Tower crane permit" } })
    })
    expect([...a.problems, ...b.problems]).toEqual([])
  } finally {
    await close()
  }
})
