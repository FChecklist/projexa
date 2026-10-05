import { test, expect, type Browser } from "@playwright/test"
import {
  PROJECT_ID, newServer, offline, online, openLocal, prepareLaptop, readLocalRow, readOutbox, retype, signInOnEvery,
  type ConflictServer, type Laptop,
} from "./support/lf-conflict-stub"

// AUDIT-100 B19: "conflicting offline edits merge safely", in a real Chromium. The SAME person on TWO laptops (two browser contexts of one
// browser, each with its own IndexedDB, service worker and outbox) goes offline on both, edits the SAME record on both, comes back online
// in order, and the second push meets a real conflict from one shared, versioned server (e2e/support/lf-conflict-stub.ts, in the real
// service's shapes: compliance-tracker projexa-sync handler.ts + drizzle/0681's conflict rule).
//
//   case 1  DIFFERENT fields   -> the second laptop's outbox merges by itself (src/lib/local-first/outbox-merge.ts) and re-sends; both
//                                 edits end up on the server AND on both laptops; nothing is lost and no card is shown.
//   case 2  the SAME field     -> the server keeps the first writer's value; the second laptop shows the person a card with both values
//                                 and keeps its own edit (nothing sent behind their back) until they choose.
//   case 3  a MONEY field      -> never merged on the laptop: whatever else the edit touched, the conflict goes to the person's card and
//                                 the server's figure is not overwritten.
// Every outcome is re-read from the server's record AND from each laptop's own database, never taken from a success message.
//
// Runs through playwright.local-first.config.ts (a production build + the release bundle + the local Auth stand-in). Nothing reaches
// Vercel, Supabase or any real network.

test.describe.configure({ mode: "serial" })

async function twoLaptops(browser: Browser, email: string, role: string, server: ConflictServer): Promise<{ a: Laptop; b: Laptop; userId: string; close: () => Promise<void> }> {
  const base = test.info().project.use.baseURL!
  const ctxA = await browser.newContext({ baseURL: base, serviceWorkers: "allow" })
  const ctxB = await browser.newContext({ baseURL: base, serviceWorkers: "allow" })
  const close = async () => { await ctxA.close().catch(() => {}); await ctxB.close().catch(() => {}) }
  try {
    const who = await signInOnEvery(email, [ctxA, ctxB])
    const a = await prepareLaptop("laptop A", ctxA, who, role, server)
    const b = await prepareLaptop("laptop B", ctxB, who, role, server)
    return { a, b, userId: who.userId, close }
  } catch (err) {
    await close()
    throw err
  }
}

const pushesOf = (server: ConflictServer, laptop: Laptop) => server.received.filter((r) => r.laptop === laptop.name)

test("case 1: two laptops edit DIFFERENT fields of one permit offline; both edits reach the server and both laptops, no card", async ({ browser }) => {
  test.slow()
  const server = newServer()
  const { a, b, userId, close } = await twoLaptops(browser, "lf-b19-fields@example.invalid", "member", server)
  try {
    expect(server.row("documents", "lf-permit-dm")).toMatchObject({ version: 3, data: { name: "Building permit - podium" } })
    const startExpiry = server.row("documents", "lf-permit-dm").data.expiry_date
    await offline(a)
    await offline(b)

    await test.step("offline, laptop A renames the permit", async () => {
      await openLocal(a, "/permits/lf-permit-dm")
      await a.page.getByTestId("doc-edit-open").click()
      await retype(a.page, "doc-edit-name", "Building permit - podium and tower")
      await a.page.getByTestId("doc-edit-save").click()
      await expect(a.page.getByTestId("permit-title")).toContainText("Building permit - podium and tower")
    })
    await test.step("offline, laptop B changes the SAME permit's end date (not its name)", async () => {
      await openLocal(b, "/permits/lf-permit-dm")
      await b.page.getByTestId("doc-edit-open").click()
      await b.page.getByTestId("doc-edit-expiryDate").fill("2027-06-30")
      await b.page.getByTestId("doc-edit-save").click()
      await expect(b.page.getByTestId("fact-end-date")).toHaveText(new Date("2027-06-30").toLocaleDateString("en-US", { timeZone: "UTC" }))
      // precondition: B never saw A's name (a test that cannot fail proves nothing)
      await expect(b.page.getByTestId("permit-title")).toContainText("Building permit - podium")
      await expect(b.page.getByTestId("permit-title")).not.toContainText("and tower")
    })
    expect(server.received, "something reached the server while both laptops were offline").toEqual([])

    await test.step("laptop A comes back first: its rename is applied (version 3 -> 4)", async () => {
      await online(a)
      await expect.poll(() => pushesOf(server, a).map((r) => r.status), { timeout: 90_000, message: "laptop A never sent its rename" }).toEqual(["applied"])
      expect(server.row("documents", "lf-permit-dm")).toMatchObject({ version: 4, data: { name: "Building permit - podium and tower", expiry_date: startExpiry } })
    })

    await test.step("laptop B comes back: a real conflict (head 4 > base 3), merged by itself and re-sent against version 4", async () => {
      await online(b)
      await expect.poll(() => pushesOf(server, b).map((r) => r.status), { timeout: 90_000, message: "laptop B's edit never settled on the server" }).toEqual(["conflict", "applied"])
      const [first, second] = pushesOf(server, b)
      expect(first.op.record).toEqual({ kind: "documents", id: "lf-permit-dm", base_version: 3 })
      expect(second.op.op_id, "the merged edit must be the SAME op, re-sent, never a second one").toBe(first.op.op_id)
      expect(second.op.record).toEqual({ kind: "documents", id: "lf-permit-dm", base_version: 4 })
      // only B's own field travels: A's name is not sent back over itself
      expect(second.op.params).toEqual({ projectId: PROJECT_ID, documentId: "lf-permit-dm", expiryDate: "2027-06-30" })
    })

    await test.step("the server holds BOTH edits", async () => {
      expect(server.row("documents", "lf-permit-dm")).toMatchObject({ version: 5, data: { name: "Building permit - podium and tower", expiry_date: "2027-06-30" } })
    })

    await test.step("laptop B: both edits in its own database, clean, at the server's version, and no card", async () => {
      await expect.poll(() => readLocalRow(b.page, userId, "documents", "lf-permit-dm"), { message: "laptop B's own copy never settled" })
        .toMatchObject({ serverVersion: 5, data: { name: "Building permit - podium and tower", expiry_date: "2027-06-30" } })
      expect((await readLocalRow(b.page, userId, "documents", "lf-permit-dm"))?.dirty ?? null).toBeNull()
      await expect.poll(() => readOutbox(b.page, userId)).toEqual([])
      await openLocal(b, "/permits/lf-permit-dm")
      await expect(b.page.getByTestId("permit-title")).toContainText("Building permit - podium and tower")
      await expect(b.page.getByTestId("doc-waiting")).toHaveCount(0)
      await expect(b.page.getByTestId("fact-end-date")).toHaveText(new Date("2027-06-30").toLocaleDateString("en-US", { timeZone: "UTC" }))
      await expect(b.page.getByTestId("outbox-conflict"), "a merge that needed nobody showed the person a card").toHaveCount(0)
    })

    await test.step("laptop A, opened again online, gets B's date through the change feed: both edits there too", async () => {
      await openLocal(a, "/permits/lf-permit-dm")
      await expect.poll(() => readLocalRow(a.page, userId, "documents", "lf-permit-dm"), { timeout: 90_000, message: "laptop A never got laptop B's edit" })
        .toMatchObject({ serverVersion: 5, data: { name: "Building permit - podium and tower", expiry_date: "2027-06-30" } })
      await openLocal(a, "/permits/lf-permit-dm")
      await expect(a.page.getByTestId("permit-title")).toContainText("Building permit - podium and tower")
      await expect(a.page.getByTestId("doc-waiting")).toHaveCount(0)
      await expect(a.page.getByTestId("fact-end-date")).toHaveText(new Date("2027-06-30").toLocaleDateString("en-US", { timeZone: "UTC" }))
      await expect(a.page.getByTestId("outbox-conflict")).toHaveCount(0)
      await expect.poll(() => readOutbox(a.page, userId)).toEqual([])
    })
    expect(pushesOf(server, a), "laptop A sent something twice").toHaveLength(1)
    expect([...a.problems, ...b.problems]).toEqual([])
  } finally {
    await close()
  }
})

test("case 2: two laptops change the SAME field to different values; the server keeps the first, the second laptop shows a card and loses nothing", async ({ browser }) => {
  test.slow()
  const server = newServer()
  const { a, b, userId, close } = await twoLaptops(browser, "lf-b19-samefield@example.invalid", "member", server)
  const mineA = "Site safety plan - laptop A (Ü)"
  const mineB = "Site safety plan - laptop B, rev 4"
  try {
    await offline(a)
    await offline(b)
    for (const [l, text] of [[a, mineA], [b, mineB]] as const) {
      await test.step(`offline, ${l.name} renames the document to "${text}"`, async () => {
        await openLocal(l, "/documents/lf-doc-safety")
        await l.page.getByTestId("doc-edit-open").click()
        await retype(l.page, "doc-edit-name", text)
        await l.page.getByTestId("doc-edit-save").click()
        await expect(l.page.getByTestId("document-title")).toContainText(text)
      })
    }

    await test.step("laptop A first: applied, the server holds A's name at version 4", async () => {
      await online(a)
      await expect.poll(() => pushesOf(server, a).map((r) => r.status), { timeout: 90_000, message: "laptop A never sent its rename" }).toEqual(["applied"])
      expect(server.row("documents", "lf-doc-safety")).toMatchObject({ version: 4, data: { name: mineA } })
    })

    await test.step("laptop B: the conflict reaches the PERSON as a card with both values", async () => {
      await online(b)
      await expect.poll(() => pushesOf(server, b).map((r) => r.status), { timeout: 90_000, message: "laptop B never sent its rename" }).toEqual(["conflict"])
      const card = b.page.getByTestId("outbox-conflict")
      await expect(card, "the conflict never reached the person on laptop B's screen").toHaveCount(1, { timeout: 30_000 })
      await expect(card).toContainText(mineB)
      await expect(card).toContainText(mineA)
    })

    await test.step("nothing was sent behind the person's back: the server still holds A's name, B sent once", async () => {
      await b.page.waitForTimeout(5_000)
      expect(pushesOf(server, b).map((r) => r.status), "laptop B re-sent a same-field disagreement without asking").toEqual(["conflict"])
      expect(server.row("documents", "lf-doc-safety")).toMatchObject({ version: 4, data: { name: mineA } })
    })

    await test.step("laptop B lost nothing: its own database still holds B's name (dirty) beside the server's, and the op waits", async () => {
      const row = await readLocalRow(b.page, userId, "documents", "lf-doc-safety")
      expect(row?.data.name).toBe(mineB)
      expect(row?.dirty, "B's edit is no longer marked as waiting").toBeTruthy()
      expect(row?.serverCopy?.data.name).toBe(mineA)
      const ops = await readOutbox(b.page, userId)
      expect(ops.map((o) => ({ functionId: o.functionId, status: o.status, name: o.params.name }))).toEqual([{ functionId: "update_document_metadata", status: "conflict", name: mineB }])
      // and across a reload (the card and the edit are stored, not held in memory)
      await b.page.reload()
      await expect(b.page.getByTestId("outbox-conflict")).toHaveCount(1, { timeout: 30_000 })
      await expect(b.page.getByTestId("document-title")).toContainText(mineB)
    })

    await test.step("laptop A is unaffected: its own name, clean, at version 4", async () => {
      await expect.poll(() => readLocalRow(a.page, userId, "documents", "lf-doc-safety")).toMatchObject({ serverVersion: 4, data: { name: mineA } })
      await expect.poll(() => readOutbox(a.page, userId)).toEqual([])
    })

    await test.step("the person chooses 'Keep mine': only then is B's name sent, against version 4, and the server takes it", async () => {
      await b.page.getByTestId("outbox-conflict").getByRole("button", { name: "Keep mine" }).click()
      await expect.poll(() => pushesOf(server, b).map((r) => r.status), { timeout: 60_000 }).toEqual(["conflict", "applied"])
      expect(pushesOf(server, b)[1].op).toMatchObject({ record: { kind: "documents", id: "lf-doc-safety", base_version: 4 }, params: { name: mineB } })
      expect(server.row("documents", "lf-doc-safety")).toMatchObject({ version: 5, data: { name: mineB } })
      await expect(b.page.getByTestId("outbox-conflict")).toHaveCount(0)
      await expect.poll(() => readOutbox(b.page, userId)).toEqual([])
      await expect.poll(() => readLocalRow(b.page, userId, "documents", "lf-doc-safety")).toMatchObject({ serverVersion: 5, data: { name: mineB } })
    })
    expect([...a.problems, ...b.problems]).toEqual([])
  } finally {
    await close()
  }
})

type AiWindow = { projexa: { ai: { update(fn: string, ref: unknown, params: unknown): Promise<{ status: string }> } } }

test("case 3: a MONEY field is never merged on the laptop: the conflict goes to the card and the server's figure stands", async ({ browser }) => {
  test.slow()
  const server = newServer()
  // manager: the rank that sees and may change a change order's cost (ai_work_link__role_rank 3)
  const { a, b, userId, close } = await twoLaptops(browser, "lf-b19-money@example.invalid", "manager", server)
  try {
    expect(server.row("change_orders", "lf-co-3")).toMatchObject({ version: 2, data: { cost_impact: "18500.00", reason: "Client asked for a double-height curtain wall." } })
    for (const l of [a, b]) {
      await expect.poll(() => l.page.evaluate(() => typeof (window as unknown as { projexa?: { ai?: unknown } }).projexa?.ai), { timeout: 60_000, message: `${l.name}: window.projexa.ai never appeared` }).toBe("object")
    }
    await offline(a)
    await offline(b)

    await test.step("offline, the person's AI on laptop A sets the cost of change order 3 to 20000", async () => {
      const r = await a.page.evaluate((projectId) => (window as unknown as AiWindow).projexa.ai.update(
        "update_change_order", { kind: "change_orders", id: "lf-co-3" }, { projectId, changeOrderId: "lf-co-3", costImpact: 20000 }), PROJECT_ID)
      expect(r.status).toBe("queued")
    })
    await test.step("offline, the person's AI on laptop B changes the reason AND sets the cost to 21000", async () => {
      const r = await b.page.evaluate((projectId) => (window as unknown as AiWindow).projexa.ai.update(
        "update_change_order", { kind: "change_orders", id: "lf-co-3" }, { projectId, changeOrderId: "lf-co-3", reason: "Client asked for a double-height curtain wall and a canopy.", costImpact: 21000 }), PROJECT_ID)
      expect(r.status).toBe("queued")
    })

    await test.step("laptop A first: its cost is applied (version 2 -> 3)", async () => {
      await online(a)
      await expect.poll(() => pushesOf(server, a).map((r) => r.status), { timeout: 90_000, message: "laptop A never sent its cost" }).toEqual(["applied"])
      expect(server.row("change_orders", "lf-co-3")).toMatchObject({ version: 3, data: { cost_impact: "20000.00" } })
    })

    await test.step("laptop B: the conflict goes to the person's card; the money is NOT merged and re-sent", async () => {
      await online(b)
      await openLocal(b, "/change-orders/lf-co-3")
      await expect.poll(() => pushesOf(server, b).length, { timeout: 90_000, message: "laptop B never sent its change" }).toBeGreaterThan(0)
      await b.page.waitForTimeout(5_000)
      expect(pushesOf(server, b).map((r) => r.status), "laptop B merged a money change by itself and re-sent it").toEqual(["conflict"])
      expect(server.row("change_orders", "lf-co-3"), "the server's cost was overwritten without the person deciding").toMatchObject({ version: 3, data: { cost_impact: "20000.00" } })
      const card = b.page.getByTestId("outbox-conflict")
      await expect(card, "a money conflict did not reach the person's card").toHaveCount(1, { timeout: 30_000 })
      // both figures, the person's own and the server's, so they can decide
      await expect(card).toContainText("21000")
      await expect(card).toContainText("20000.00")
    })

    await test.step("laptop B lost nothing: its edit (cost and reason) still waits in its own outbox", async () => {
      const ops = await readOutbox(b.page, userId)
      expect(ops.map((o) => ({ status: o.status, params: o.params }))).toEqual([
        { status: "conflict", params: { projectId: PROJECT_ID, changeOrderId: "lf-co-3", reason: "Client asked for a double-height curtain wall and a canopy.", costImpact: 21000 } },
      ])
      const row = await readLocalRow(b.page, userId, "change_orders", "lf-co-3")
      expect(row?.dirty).toBeTruthy()
      expect(row?.serverCopy?.data.cost_impact).toBe("20000.00")
    })
    expect([...a.problems, ...b.problems]).toEqual([])
  } finally {
    await close()
  }
})
