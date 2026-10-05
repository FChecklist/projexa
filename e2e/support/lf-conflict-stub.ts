// AUDIT-100 B19 ("conflicting offline edits merge safely"). ONE shared, VERSIONED server that TWO laptops (two browser contexts of one
// Playwright browser, the same person signed in on both) push to, so a spec can make both edit the same record offline and watch what
// the second push really meets.
//
// SHAPES. Copied from compliance-tracker supabase/functions/projexa-sync/handler.ts (origin/main) and drizzle/0681_projexa_sync_push.sql,
// not invented:
//   * the conflict rule is 0681's step 7: an edit carries record {kind, id, base_version}; the record's HEAD version is read; head >
//     base -> `conflict`, NOTHING is written; otherwise the op runs and the head moves by one;
//   * a conflict answers {op_id, status:"conflict", version: <head>, base_version, server: <the current row>} and an applied op
//     {op_id, status:"applied", record_id, route, version, server: <the row at its new version>} (handler.ts push(): `results[i]`, then
//     `signedRows` fills `server` for conflicts and applied ops alike as {kind, id, version, updated_at, data, sig, kid});
//   * no signing key is configured here, so rows are unsigned exactly as the real service sends them without one (sig null, kid null);
//   * the same op_id again answers `duplicate` with the stored result (the ledger: exactly once);
//   * an applied edit appends to the project's change feed (POST /changes {after_seq} -> {changes:[{seq,kind,id,version,op}], next_seq,
//     has_more, head_seq, reset_required, epoch}) and moves GET /heads, so the OTHER laptop learns of it the way a real one does.
// The rows are lf-documents-stub.ts's fixtures (the documents, minutes and change-order screens' own records), deep-copied per server.
// Every name, id and figure is made up. Nothing here reaches Vercel, Supabase or any real network.
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test"
import { APP_ORIGIN, STUB_PORT, type LocalSession } from "./boq-local"
import {
  EPOCH, KIND_ROWS, ORG_ID, PROJECT_ID, PROJECT_NAME, SYNC_BASE, VERIDIAN_PERSON_ID, readOutbox, readPersonMeta, seesMoney, stubAppApis,
  type AppApiStub, type Net, type PushedOp,
} from "./lf-documents-stub"

export { PROJECT_ID, readOutbox }

type ServerRow = { kind: string; id: string; version: number; updated_at: string; data: Record<string, unknown>; deleted?: boolean }
export type FeedEntry = { seq: number; kind: string; id: string; version: number; op: "I" | "U" | "D" }
/** One op as the server received it and what it answered. */
export type Received = { laptop: string; op: PushedOp; status: string; version: number | null }

export type ConflictServer = {
  rows: Map<string, ServerRow>
  feed: FeedEntry[]
  received: Received[]
  /** The push ledger (platform.projexa_sync_op): an applied op_id answers `duplicate` with its stored result. */
  ledger: Map<string, { record_id: string; version: number }>
  /** The server's row of one record, as it holds it now (a copy). */
  row: (kind: string, id: string) => { version: number; data: Record<string, unknown> }
}

/** Money columns of each kind (records_core): NULL and named in hidden_fields below the money rank (as lf-documents-stub.ts). */
const MONEY: Record<string, string[]> = { change_orders: ["cost_impact"], timesheets: ["hourly_rate_snapshot", "invoice_item_id"] }

export function newServer(): ConflictServer {
  const rows = new Map<string, ServerRow>()
  for (const [kind, list] of Object.entries(KIND_ROWS)) {
    for (const r of list) rows.set(`${kind}:${r.id}`, { kind, id: r.id, version: r.version, updated_at: r.updated_at, data: structuredClone(r.data), ...(r.deleted ? { deleted: true } : {}) })
  }
  const server: ConflictServer = {
    rows, feed: [], received: [], ledger: new Map(),
    row: (kind, id) => {
      const r = rows.get(`${kind}:${id}`)
      if (!r) throw new Error(`the server holds no ${kind} ${id}`)
      return { version: r.version, data: structuredClone(r.data) }
    },
  }
  return server
}

/** The columns an applied edit changes, as the real executors write them (registry parameter -> records_core column). */
function columnsOf(op: PushedOp): Record<string, unknown> {
  const p = op.params
  const out: Record<string, unknown> = {}
  if (op.function_id === "update_document_metadata") {
    if (p.name !== undefined) out.name = p.name
    if (p.category !== undefined) out.category = p.category
    if (p.expiryDate !== undefined) out.expiry_date = p.expiryDate
  }
  if (op.function_id === "update_mom_minutes" && p.minutes !== undefined) out.minutes = p.minutes
  if (op.function_id === "update_change_order") {
    for (const [param, column] of [["title", "title"], ["description", "description"], ["reason", "reason"], ["trade", "trade"], ["scheduleImpactDays", "schedule_impact_days"]] as const) {
      if (p[param] !== undefined) out[column] = p[param]
    }
    // a money column is stored as numeric(…, 2): the server's own figure, never the laptop's spelling of it
    if (p.costImpact !== undefined) out.cost_impact = p.costImpact === null ? null : Number(p.costImpact).toFixed(2)
  }
  return out
}

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
})

/** Answers the sync service for ONE laptop (page) from the shared server. `role` decides the redaction, as records_core does. */
export async function attachLaptop(page: Page, laptop: string, who: LocalSession, net: Net, role: string, server: ConflictServer): Promise<void> {
  const hidden = (kind: string) => (seesMoney(role) ? [] : (MONEY[kind] ?? []))
  const item = (r: ServerRow) => ({
    id: r.id, updated_at: r.updated_at, version: r.version,
    data: { ...r.data, ...Object.fromEntries(hidden(r.kind).map((f) => [f, null])) },
    ...(r.deleted ? { deleted: true } : {}),
  })
  const signed = (r: ServerRow) => ({ kind: r.kind, ...item(r), sig: null, kid: null })
  const head = () => server.feed.at(-1)?.seq ?? 0
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) })
  const now = () => new Date().toISOString()

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"]
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) })
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused")
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length)
    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: VERIDIAN_PERSON_ID, auth_user_id: who.userId, name: "Lina Haddad", role, org_id: ORG_ID },
        projects: [{ id: PROJECT_ID, name: PROJECT_NAME, status: "active" }],
        kinds: Object.keys(KIND_ROWS).map((kind) => ({ kind, project_scoped: true, cursor_field: "updated_at", deletes_supported: true })),
        view_class: `lf-doc-${role}`, org_kinds: [], org_view_class: null,
        release: { current: null, min_compatible: null, protocol: 2 },
        server_time: now(),
      })
    }
    if (request.method() === "POST" && path === "/attest") return json(route, origin, {})
    if (request.method() === "GET" && path === "/heads") {
      return json(route, origin, {
        heads: { [PROJECT_ID]: head(), __org__: 0 }, projects_etag: "lf-doc-projects-1", role, view_class: `lf-doc-${role}`, org_view_class: null, epoch: EPOCH, server_time: now(),
      })
    }
    if (request.method() === "POST" && path === "/pull") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string; ids?: string[] }
      if (body.project_id !== PROJECT_ID || !body.kind || !(body.kind in KIND_ROWS)) return json(route, origin, { error: "not found" }, 404)
      const all = [...server.rows.values()].filter((r) => r.kind === body.kind)
      const rows = body.ids ? all.filter((r) => body.ids!.includes(r.id)) : all
      const h = hidden(body.kind)
      return json(route, origin, { items: rows.map(item), kid: null, next_cursor: null, has_more: false, hidden_fields: h, redacted: h.length > 0, server_time: now() })
    }
    if (request.method() === "POST" && path === "/changes") {
      const body = request.postDataJSON() as { after_seq?: number | null }
      const after = typeof body.after_seq === "number" ? body.after_seq : null
      // after_seq null: just the head position (handler.ts changes())
      const list = after === null ? [] : server.feed.filter((c) => c.seq > after)
      return json(route, origin, { changes: list, next_seq: list.at(-1)?.seq ?? after ?? head(), has_more: false, head_seq: head(), reset_required: false, epoch: EPOCH, server_time: now() })
    }
    if (request.method() === "POST" && path === "/ids") {
      const body = request.postDataJSON() as { kind?: string }
      const list = [...server.rows.values()].filter((r) => r.kind === body.kind && !r.deleted).sort((a, b) => a.id.localeCompare(b.id))
      return json(route, origin, { ids: list.map((r) => r.id), has_more: false, next_id: null, versions: list.map((r) => r.version), head_seq: head(), epoch: EPOCH, server_time: now() })
    }
    if (request.method() === "POST" && path === "/push") {
      const body = request.postDataJSON() as { device_id: string; ops: PushedOp[] }
      const results = body.ops.map((op) => {
        const note = (status: string, version: number | null) => server.received.push({ laptop, op: structuredClone(op), status, version })
        const prior = server.ledger.get(op.op_id)
        if (prior) {
          note("duplicate", prior.version)
          return { op_id: op.op_id, status: "duplicate", record_id: prior.record_id, route: null, version: prior.version }
        }
        if (!op.record) {
          note("rejected", null)
          return { op_id: op.op_id, status: "rejected", error: { code: "NOT_PART_OF_THIS_STUB" } }
        }
        const row = server.rows.get(`${op.record.kind}:${op.record.id}`)
        const headVersion = row && !row.deleted ? row.version : 0
        // 0681 step 7: the record moved past the version the laptop edited -> CONFLICT, nothing is written
        if (headVersion > op.record.base_version) {
          note("conflict", headVersion)
          return { op_id: op.op_id, status: "conflict", version: headVersion, base_version: op.record.base_version, server: row && !row.deleted ? signed(row) : null }
        }
        if (!row || row.deleted) {
          note("rejected", null)
          return { op_id: op.op_id, status: "rejected", error: { code: "NOT_FOUND" } }
        }
        Object.assign(row.data, columnsOf(op))
        row.version += 1
        row.updated_at = now()
        server.feed.push({ seq: head() + 1, kind: row.kind, id: row.id, version: row.version, op: "U" })
        server.ledger.set(op.op_id, { record_id: row.id, version: row.version })
        note("applied", row.version)
        return { op_id: op.op_id, status: "applied", record_id: row.id, route: null, version: row.version, server: signed(row) }
      })
      return json(route, origin, { results, server_time: now() })
    }
    if (request.method() === "GET" && path === "/release/current") return json(route, origin, { registered: true, current: null, min_compatible: null, protocol: 2, server_time: now() })
    if (request.method() === "POST" && path === "/release/register") return json(route, origin, { registered: true, server_time: now() })
    if (request.method() === "POST" && path === "/install") return json(route, origin, { recorded: true, server_time: now() })
    if (request.method() === "POST" && path === "/prepare") return json(route, origin, { recorded: true, server_time: now() })
    return json(route, origin, { error: "not part of the local stub" }, 404)
  })
}

// ─── the same person on two laptops ─────────────────────────────────────────────────────────────

/** ONE sign-in of the person (the local Auth stand-in), its cookie set on every laptop: the same person, the same account. */
export async function signInOnEvery(email: string, contexts: BrowserContext[]): Promise<LocalSession> {
  const res = await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(email)}`)
  if (!res.ok) throw new Error(`the local Auth stand-in answered HTTP ${res.status}`)
  const session = (await res.json()) as LocalSession
  for (const c of contexts) await c.addCookies([{ name: session.cookieName, value: session.cookieValue, url: APP_ORIGIN }])
  return session
}

export type Laptop = { name: string; page: Page; context: BrowserContext; net: Net; app: AppApiStub; problems: string[] }

const EXPECTED_CONSOLE = [/favicon\.ico/, /net::ERR_INTERNET_DISCONNECTED/, /net::ERR_CONNECTION_REFUSED/, /net::ERR_FAILED/, /Failed to load resource/, /Failed to fetch/]

/** One laptop: its page answered by the shared server, opened online once (the first-run screen copies the workspace), worker in control. */
export async function prepareLaptop(name: string, context: BrowserContext, who: LocalSession, role: string, server: ConflictServer): Promise<Laptop> {
  const page = await context.newPage()
  const problems: string[] = []
  page.on("pageerror", (err) => problems.push(`${name} pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = `${msg.text()} ${msg.location().url ?? ""}`
    if (!EXPECTED_CONSOLE.some((re) => re.test(text))) problems.push(`${name} console.error: ${text}`)
  })
  const net: Net = { mode: "up" }
  await attachLaptop(page, name, who, net, role, server)
  const app = await stubAppApis(page, who, net, role)
  await test.step(`${name}: online once as ${role}, the workspace is copied to this laptop`, async () => {
    await page.goto(`/documents?projectId=${PROJECT_ID}`)
    await expect(page.getByTestId("workspace-prepare"), `${name}: the 'Preparing your PROJEXA workspace' screen never finished`).toHaveCount(0, { timeout: 240_000 })
    for (const kind of Object.keys(KIND_ROWS)) {
      await expect
        .poll(() => readPersonMeta(page, who.userId, `sync:done:${PROJECT_ID}:${kind}`), { timeout: 120_000, message: `${name}: the ${kind} rows were never copied` })
        .toBeTruthy()
    }
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: `${name}: the service worker does not control the page` }).toBe(true)
  })
  return { name, page, context, net, app, problems }
}

export async function offline(l: Laptop) {
  l.net.mode = "offline"
  await l.context.setOffline(true)
}

export async function online(l: Laptop) {
  l.net.mode = "up"
  await l.context.setOffline(false)
}

/** Opens an app path from the on-laptop shell. */
export async function openLocal(l: Laptop, path: string) {
  await l.page.goto(`/local${path}${path.includes("?") ? "&" : "?"}projectId=${PROJECT_ID}`)
}

/** Replaces an input's whole text with real keystrokes (select all, then type), the way a person edits a field. */
export async function retype(page: Page, testId: string, text: string) {
  await page.getByTestId(testId).click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(text)
}

/** The laptop's own stored copy of one record (IndexedDB projexa-local:<user>, store `records`), straight from the database. */
export type StoredRow = { data: Record<string, unknown>; serverVersion?: number; dirty?: string | null; serverCopy?: { data: Record<string, unknown>; version: number | null } }
export function readLocalRow(page: Page, userId: string, kind: string, id: string): Promise<StoredRow | null> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<StoredRow | null>((resolve) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("records")) { db.close(); resolve(null); return }
          const get = db.transaction("records", "readonly").objectStore("records").get(key)
          get.onerror = () => { db.close(); resolve(null) }
          get.onsuccess = () => { db.close(); resolve((get.result as StoredRow | undefined) ?? null) }
        }
      }),
    { dbName: `projexa-local:${userId}`, key: `${kind}:${id}` },
  )
}
