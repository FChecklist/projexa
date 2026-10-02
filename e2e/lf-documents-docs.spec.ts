import { test, expect } from "@playwright/test"
import { expectCleanConsole, goOffline, goOnline, noCrash, openLocal, prepareLaptop } from "./support/lf-documents-prepare"
import { LONG_DOC_NAME, PROJECT_ID, PROJECT_NAME, UNICODE_DOC_NAME, readOutbox } from "./support/lf-documents-stub"

// lf-e10b. The DOCUMENTS cluster (src/lib/local-first/shell/clusters/documents.ts) in a real Chromium: permits, drawings, documents and
// minutes of meetings open from the laptop's own database with the network OFF, show the real values, let the person change what the
// online screens let them change, keep the change on the laptop across a reload, and send it EXACTLY ONCE, with the real AI work link
// registry's function id and parameter names, when the connection is back.
//
// Runs through playwright.local-first.config.ts (a production build + the release bundle + the local Auth stand-in); every sync and
// /api answer comes from e2e/support/lf-documents-stub.ts. Nothing reaches Vercel or any real network.

test.describe.configure({ mode: "serial" })

test("documents: the four lists and their objects open offline from the laptop, with their real values", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "owner")
  await goOffline(context, p)

  await test.step("documents list: names, categories, sizes; the soft-deleted and other-project rows are not shown", async () => {
    await openLocal(page, "/documents")
    const list = page.getByTestId("documents-list")
    await expect(list).toHaveAttribute("data-state", "local")
    await expect(list.locator("h1")).toHaveText(`Documents / ${PROJECT_NAME}`)
    const row = (id: string) => page.locator(`[data-testid="documents-list-row"][data-doc-id="${id}"]`)
    await expect(row("lf-doc-safety")).toContainText("Site safety plan")
    await expect(row("lf-doc-safety")).toContainText("240 KB")
    await expect(row("lf-doc-unicode")).toContainText(UNICODE_DOC_NAME)
    await expect(row("lf-doc-unicode")).toContainText("3.2 MB")
    // the long name renders whole, and its null fields read as dashes, not "null"
    await expect(row("lf-doc-long")).toContainText(LONG_DOC_NAME)
    await expect(row("lf-doc-long")).not.toContainText("null")
    await expect(row("lf-doc-withdrawn")).toHaveCount(0)
    await noCrash(page)
  })

  await test.step("one document: facts, and the null fields as dashes", async () => {
    await openLocal(page, "/documents/lf-doc-long")
    await expect(page.getByTestId("document-object")).toHaveAttribute("data-state", "local")
    await expect(page.getByTestId("document-title")).toHaveText(LONG_DOC_NAME)
    await expect(page.getByTestId("fact-category")).toHaveText("-")
    await expect(page.getByTestId("fact-size")).toHaveText("-")
    await expect(page.getByTestId("fact-expiry")).toHaveText("-")
    await openLocal(page, "/documents/lf-doc-unicode")
    await expect(page.getByTestId("document-title")).toHaveText(UNICODE_DOC_NAME)
    await expect(page.getByTestId("fact-category")).toHaveText("specification")
    await noCrash(page)
  })

  await test.step("permits: number, authority and the expiry in words", async () => {
    await openLocal(page, "/permits")
    await expect(page.getByTestId("permits-list")).toHaveAttribute("data-state", "local")
    const dm = page.locator('[data-testid="permits-list-row"][data-doc-id="lf-permit-dm"]')
    await expect(dm).toContainText("DM-2026-0042")
    await expect(dm).toContainText("Dubai Municipality")
    await expect(dm.getByTestId("permit-status")).toHaveText("valid, 180 days left")
    const hot = page.locator('[data-testid="permits-list-row"][data-doc-id="lf-permit-hot"]')
    await expect(hot.getByTestId("permit-status")).toHaveText("expired 1 day ago")
    await expect(page.getByTestId("permits-list-row")).toHaveCount(2)
    await openLocal(page, "/permits/lf-permit-dm")
    await expect(page.getByTestId("permit-title")).toHaveText("Building permit - podium")
    await expect(page.getByTestId("fact-issuing-authority")).toHaveText("Dubai Municipality")
    await noCrash(page)
  })

  await test.step("drawings: register fields, and the revision history of one sheet", async () => {
    await openLocal(page, "/drawings")
    await expect(page.getByTestId("drawings-list")).toHaveAttribute("data-state", "local")
    const c = page.locator('[data-testid="drawings-list-row"][data-doc-id="lf-dwg-a101-c"]')
    await expect(c).toContainText("A-101")
    await expect(c).toContainText("Architectural")
    await expect(c).toContainText("✓ Current")
    // "Current only" (the default) hides rev B; unticking shows both revisions
    await expect(page.locator('[data-testid="drawings-list-row"][data-doc-id="lf-dwg-a101-b"]')).toHaveCount(0)
    await page.getByTestId("drawings-current-only").uncheck()
    await expect(page.locator('[data-testid="drawings-list-row"][data-doc-id="lf-dwg-a101-b"]')).toContainText("○ Superseded")
    await openLocal(page, "/drawings/lf-dwg-a101-c")
    await expect(page.getByTestId("drawing-title")).toHaveText("A-101 Ground floor plan")
    await expect(page.getByTestId("fact-rev")).toHaveText("C")
    await expect(page.getByTestId("fact-supersedes")).toHaveText("A-101 Ground floor plan (rev B)")
    await expect(page.getByTestId("drawing-history-item")).toHaveCount(2)
    await noCrash(page)
  })

  await test.step("minutes of meetings: the list, a draft's agenda and minutes, and a published one locked", async () => {
    await openLocal(page, "/moms")
    await expect(page.getByTestId("moms-list")).toHaveAttribute("data-state", "local")
    await expect(page.locator('[data-testid="moms-list-row"][data-mom-id="lf-mom-12"]')).toContainText("Weekly site coordination #12")
    await expect(page.locator('[data-testid="moms-list-row"][data-mom-id="lf-mom-12"]')).toContainText("7")
    await openLocal(page, "/moms/lf-mom-12")
    await expect(page.getByTestId("mom-title")).toHaveText("Weekly site coordination #12")
    await expect(page.getByTestId("mom-agenda").locator("li")).toHaveText(["Podium pour sequence", "Façade mock-up approval", "Crane relocation"])
    await expect(page.getByTestId("mom-minutes")).toHaveText("Pour of zone B moved to Thursday.")
    await expect(page.getByTestId("mom-amend-open")).toBeVisible()
    await openLocal(page, "/moms/lf-mom-11")
    await expect(page.getByTestId("mom-locked")).toBeVisible()
    await expect(page.getByTestId("mom-amend-open")).toHaveCount(0)
    await noCrash(page)
  })

  await test.step("the create screens need the server: a calm sentence offline, never a crash", async () => {
    for (const path of ["/permits/new", "/drawings/new", "/documents/upload", "/moms/new"]) {
      await openLocal(page, path)
      await expect(page.getByTestId("documents-server-only"), `${path} did not explain itself offline`).toBeVisible()
      await noCrash(page)
    }
  })

  expect(await readOutbox(page, p.session.userId), "reading must not queue anything").toEqual([])
  await goOnline(context, p)
  expectCleanConsole(p.console)

  await test.step("online, a create screen falls through to the server's own page (never read as the permit whose id is 'new')", async () => {
    await openLocal(page, "/permits/new", { leavesTheShell: true })
    await expect(page).toHaveURL(/\/permits\/new\?(.*&)?px-server=1/, { timeout: 30_000 })
    expect(new URL(page.url()).searchParams.get("projectId")).toBe(PROJECT_ID)
    expect(new URL(page.url()).pathname).toBe("/permits/new")
    await expect(page.getByTestId("local-shell")).toHaveCount(0)
  })
})

/** Replaces an input's whole text with real keystrokes (select all, then type), the way a person edits a field. */
async function retype(page: import("@playwright/test").Page, testId: string, text: string) {
  const input = page.getByTestId(testId)
  await input.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(text)
}

test("documents: edits made offline wait on the laptop, survive a reload, and are sent exactly once with the registry's names", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "member")
  await goOffline(context, p)

  await test.step("offline: rename a document by typing; it shows at once and waits", async () => {
    await openLocal(page, "/documents/lf-doc-safety")
    await page.getByTestId("doc-edit-open").click()
    await retype(page, "doc-edit-name", "Site safety plan - rev 3 (Ü)")
    await page.getByTestId("doc-edit-save").click()
    await expect(page.getByTestId("document-title")).toContainText("Site safety plan - rev 3 (Ü)")
    await expect(page.getByTestId("doc-waiting")).toHaveText("Waiting to sync")
    await expect(page.getByTestId("doc-edit-note")).toHaveText("Saved on this laptop. It will be sent to the server when you are connected.")
  })

  await test.step("offline: a permit's name and end date", async () => {
    await openLocal(page, "/permits/lf-permit-dm")
    await page.getByTestId("doc-edit-open").click()
    await retype(page, "doc-edit-name", "Building permit - podium and tower")
    await page.getByTestId("doc-edit-expiryDate").fill("2027-06-30")
    await page.getByTestId("doc-edit-save").click()
    await expect(page.getByTestId("permit-title")).toContainText("Building permit - podium and tower")
    await expect(page.getByTestId("fact-end-date")).toHaveText(new Date("2027-06-30").toLocaleDateString("en-US", { timeZone: "UTC" }))
    await expect(page.getByTestId("doc-waiting")).toBeVisible()
  })

  await test.step("offline: a drawing's name (the only detail its online screen edits that a function takes)", async () => {
    await openLocal(page, "/drawings/lf-dwg-a101-c")
    await page.getByTestId("doc-edit-open").click()
    await expect(page.getByTestId("doc-edit-category")).toHaveCount(0)
    await expect(page.getByTestId("doc-edit-expiryDate")).toHaveCount(0)
    await retype(page, "doc-edit-name", "A-101 Ground floor plan - lobby revised")
    await page.getByTestId("doc-edit-save").click()
    await expect(page.getByTestId("drawing-title")).toContainText("A-101 Ground floor plan - lobby revised")
  })

  await test.step("offline: amend the minutes of a draft meeting by typing (the MoM form)", async () => {
    await openLocal(page, "/moms/lf-mom-12")
    await page.getByTestId("mom-amend-open").click()
    await page.getByTestId("mom-minutes-input").click()
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type(" Crane moves on 3 Oct; façade mock-up approved.")
    await page.getByTestId("mom-amend-save").click()
    await expect(page.getByTestId("mom-minutes")).toHaveText("Pour of zone B moved to Thursday. Crane moves on 3 Oct; façade mock-up approved.")
    await expect(page.getByTestId("doc-waiting")).toBeVisible()
    await noCrash(page)
  })

  await test.step("the four edits are stored in the outbox, nothing was sent", async () => {
    const ops = await readOutbox(page, p.session.userId)
    expect(ops.map((o) => o.functionId).sort()).toEqual(["update_document_metadata", "update_document_metadata", "update_document_metadata", "update_mom_minutes"])
    expect(p.sync.pushed, "something was pushed while offline").toEqual([])
  })

  await test.step("offline: a reload keeps every edit (outbox + the laptop's own copy)", async () => {
    await page.reload()
    await expect(page.getByTestId("mom-minutes")).toContainText("façade mock-up approved.")
    await openLocal(page, "/documents")
    await expect(page.locator('[data-testid="documents-list-row"][data-doc-id="lf-doc-safety"]')).toContainText("Site safety plan - rev 3 (Ü)")
    await expect(page.locator('[data-testid="documents-list-row"][data-doc-id="lf-doc-safety"]').getByTestId("doc-waiting")).toBeVisible()
  })

  await test.step("back online, staying on the laptop's screen: each edit is sent exactly once, in the registry's parameter names", async () => {
    await goOnline(context, p)
    await expect.poll(() => p.sync.pushed.length, { timeout: 90_000, message: "the offline edits were never sent after the laptop came back online" }).toBe(4)
    // Ops on DIFFERENT rows may leave in different requests (an op that was tried while offline waits out its retry delay); the outbox
    // keeps the order only per row (outbox.ts eligible()), so these lists are compared by row, not by arrival.
    const byFn = (fn: string) => p.sync.pushed.filter((o) => o.function_id === fn).sort((a, b) => String(a.record?.id).localeCompare(String(b.record?.id)))
    expect(byFn("update_mom_minutes").map((o) => o.params)).toEqual([
      { projectId: PROJECT_ID, meetingId: "lf-mom-12", minutes: "Pour of zone B moved to Thursday. Crane moves on 3 Oct; façade mock-up approved." },
    ])
    expect(byFn("update_document_metadata").map((o) => o.params)).toEqual([
      { projectId: PROJECT_ID, documentId: "lf-doc-safety", name: "Site safety plan - rev 3 (Ü)" },
      { projectId: PROJECT_ID, documentId: "lf-dwg-a101-c", name: "A-101 Ground floor plan - lobby revised" },
      { projectId: PROJECT_ID, documentId: "lf-permit-dm", name: "Building permit - podium and tower", expiryDate: "2027-06-30" },
    ])
    for (const op of p.sync.pushed) expect(op.project_id).toBe(PROJECT_ID)
    expect(p.sync.pushed.map((o) => o.record).sort((a, b) => String(a?.id).localeCompare(String(b?.id)))).toEqual([
      { kind: "documents", id: "lf-doc-safety", base_version: 3 },
      { kind: "documents", id: "lf-dwg-a101-c", base_version: 3 },
      { kind: "meeting_minutes", id: "lf-mom-12", base_version: 5 },
      { kind: "documents", id: "lf-permit-dm", base_version: 3 },
    ])
    expect(new Set(p.sync.pushed.map((o) => o.op_id)).size, "an op was sent twice").toBe(4)
    await expect.poll(() => readOutbox(page, p.session.userId), { message: "the sent edits are still stored as waiting" }).toEqual([])
    await page.reload()
    await expect(page.locator('[data-testid="documents-list-row"][data-doc-id="lf-doc-safety"]')).toContainText("Site safety plan - rev 3 (Ü)")
    await expect(page.getByTestId("doc-waiting")).toHaveCount(0)
    // and nothing is sent twice
    await page.waitForTimeout(3_000)
    expect(p.sync.pushed).toHaveLength(4)
  })
  expectCleanConsole(p.console)
})

test("documents: the AI asking to delete a permit makes a DRAFT; nothing leaves until the person confirms; then exactly one delete_permit", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "member")

  await test.step("the browser AI's door is open on the app's page", async () => {
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { projexa?: { ai?: unknown } }).projexa?.ai), { timeout: 60_000, message: "window.projexa.ai never appeared" }).toBe("object")
  })

  await test.step("the AI asks: it gets a draft, and nothing is queued or sent", async () => {
    const result = await page.evaluate(
      (projectId) => (window as unknown as { projexa: { ai: { delete(fn: string, ref: unknown, params: unknown): Promise<{ status: string }> } } }).projexa.ai.delete(
        "delete_permit", { kind: "documents", id: "lf-permit-hot" }, { projectId, permitId: "lf-permit-hot" },
      ),
      PROJECT_ID,
    )
    expect(result.status).toBe("draft")
    await expect(page.getByRole("region", { name: "Requests from your AI" })).toContainText("Hot works permit")
    await page.waitForTimeout(2_000)
    expect(await readOutbox(page, p.session.userId)).toEqual([])
    expect(p.sync.pushed).toEqual([])
  })

  await test.step("a script (the AI itself) cannot click the confirm for the person", async () => {
    await page.evaluate(() => (document.querySelector('[aria-label="Confirm: Delete permit"], [aria-label^="Confirm:"]') as HTMLButtonElement | null)?.click())
    await page.waitForTimeout(1_000)
    expect(await readOutbox(page, p.session.userId)).toEqual([])
  })

  await test.step("offline, the PERSON confirms with a real click: one op waits on the laptop", async () => {
    await goOffline(context, p)
    await page.getByRole("button", { name: /^Confirm:/ }).click()
    await expect.poll(() => readOutbox(page, p.session.userId).then((ops) => ops.map((o) => o.functionId))).toEqual(["delete_permit"])
    expect(p.sync.pushed).toEqual([])
  })

  await test.step("back online: exactly one delete_permit, in the registry's parameter names", async () => {
    await goOnline(context, p)
    await expect.poll(() => p.sync.pushed.length, { timeout: 90_000, message: "the confirmed delete was never sent" }).toBe(1)
    expect(p.sync.pushed[0]).toMatchObject({
      function_id: "delete_permit", project_id: PROJECT_ID, params: { projectId: PROJECT_ID, permitId: "lf-permit-hot" },
      record: { kind: "documents", id: "lf-permit-hot", base_version: 3 },
    })
    await page.waitForTimeout(3_000)
    expect(p.sync.pushed).toHaveLength(1)
  })
  expectCleanConsole(p.console)
})

test("documents: a viewer reads everything offline but is offered no change at all", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "viewer")
  await goOffline(context, p)
  for (const [path, title] of [
    ["/documents/lf-doc-safety", "document-title"],
    ["/permits/lf-permit-dm", "permit-title"],
    ["/drawings/lf-dwg-a101-c", "drawing-title"],
  ] as const) {
    await openLocal(page, path)
    await expect(page.getByTestId(title)).not.toBeEmpty()
    await expect(page.getByTestId("doc-edit-open"), `${path} offered an edit to a viewer`).toHaveCount(0)
    await noCrash(page)
  }
  await openLocal(page, "/moms/lf-mom-12")
  await expect(page.getByTestId("mom-minutes")).toHaveText("Pour of zone B moved to Thursday.")
  await expect(page.getByTestId("mom-amend-open"), "a viewer was offered 'Amend the minutes'").toHaveCount(0)
  expect(await readOutbox(page, p.session.userId)).toEqual([])
  await goOnline(context, p)
  expectCleanConsole(p.console)
})

test("documents: an edit the server REJECTS and one in CONFLICT reach the person on the laptop's screen, and what they typed is kept", async ({ page, context }) => {
  const p = await prepareLaptop(page, context, "member")
  p.sync.answerNext("update_mom_minutes", { status: "rejected", code: "NOT_PERMITTED" })
  p.sync.answerNext("update_document_metadata", { status: "conflict", serverVersion: 7, server: { id: "lf-doc-safety", name: "Site safety plan (issued by HSE)" } })
  await goOffline(context, p)

  const typed = "Zone C pour postponed; awaiting the consultant's sign-off."
  await openLocal(page, "/moms/lf-mom-12")
  await page.getByTestId("mom-amend-open").click()
  await page.getByTestId("mom-minutes-input").click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(typed)
  await page.getByTestId("mom-amend-save").click()
  await expect(page.getByTestId("mom-minutes")).toHaveText(typed)

  await openLocal(page, "/documents/lf-doc-safety")
  await page.getByTestId("doc-edit-open").click()
  await retype(page, "doc-edit-name", "Site safety plan - laptop edit")
  await page.getByTestId("doc-edit-save").click()
  await expect(page.getByTestId("document-title")).toContainText("Site safety plan - laptop edit")

  await page.reload()
  await goOnline(context, p)
  await expect.poll(() => p.sync.pushed.length, { timeout: 90_000, message: "the two edits were never sent" }).toBe(2)

  await test.step("the rejected amendment: a card on THIS screen says it was not saved, and keeps the text", async () => {
    const draft = page.getByTestId("outbox-draft")
    await expect(draft, "the refusal never reached the person on the laptop's screen").toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId("outbox-draft-text")).toContainText(typed)
  })

  await test.step("the conflict: both values are shown, and the person's own value is not lost", async () => {
    const conflict = page.getByTestId("outbox-conflict")
    await expect(conflict, "the conflict never reached the person on the laptop's screen").toHaveCount(1)
    await expect(conflict).toContainText("Site safety plan - laptop edit")
    await expect(conflict).toContainText("Site safety plan (issued by HSE)")
  })
  expect(p.sync.pushed.map((o) => o.function_id).sort()).toEqual(["update_document_metadata", "update_mom_minutes"])
  expectCleanConsole(p.console)
})
