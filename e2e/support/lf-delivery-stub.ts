// LOCAL-FIRST, package lf-e10a (delivery modules in a real browser): a fixture-driven stand-in for the sync service and the page's /api
// calls, in the REAL service's shapes, so e2e/lf-delivery-offline.spec.ts can open work progress, labour, materials and the schedule from
// the laptop's own database with the network OFF and prove that each edit made there is sent exactly once when the connection is back.
//
// SHAPES. Every answer below follows compliance-tracker supabase/functions/projexa-sync/handler.ts (origin/main) and
// docs/local-first/CONTRACT.md:
//   GET  /manifest   user.id = the VERIDIAN id, user.auth_user_id = the sign-in id, kinds[] with project_scoped/cursor_field/deletes_supported
//   GET  /heads      heads per project + "__org__", role, view_class, epoch
//   POST /pull       {project_id, kind, cursor?, ids?} -> {items:[{id, updated_at, version, data}], kid:null, next_cursor, has_more, hidden_fields}
//                    (no signing key here, so `kid: null` and no `sig`, exactly what the real service sends without one)
//   POST /changes    nothing changed (an empty feed at head 0)
//   POST /ids        every id of the kind with its version (what the laptop reconciles deletes against)
//   POST /push       {device_id, ops:[{op_id, function_id, project_id, params, record_kind?, client_at}]} -> {results:[...]}, one result per op:
//                      applied   {op_id, status:"applied", record_id, route, version, server:null}  (handler.ts line ~1144)
//                      rejected  {op_id, status:"rejected", error:{code}}
//                      conflict  {op_id, status:"conflict", version, base_version, server:null}     (only ever for an EDIT, see the spec)
// The money columns of each kind (drizzle/0643's ai_work_link_record_kinds hidden lists) are NULL and named in `hidden_fields` for a
// read-only role, as the real redaction does.
//
// An APPLIED op becomes a real server row here (its id `srv-<n>`, the server's own computed values: an attendance mark's cost from the
// worker's rate, a receipt's unit cost from the material, a progress entry's percent from the BOQ line's quantity), so the laptop's
// refetch after the push (outbox.ts settleApplied -> POST /pull with ids) finds it and the screen shows the server's row, not the guess.
//
// Every name, id and figure is made up. Nothing here reaches Vercel, Supabase or any real network.

import type { BrowserContext, ConsoleMessage, Page, Route } from "@playwright/test"
import { signInLocally, stubAppApis, type AppStub, type LocalSession } from "./boq-local"
import type { ProjectFixture } from "./boq-fixture"

// Written out in full on purpose: the spec must fail if src/lib/local-first/sync-client.ts names a different address.
export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync"

export const PROJECT_ID = "lf-dl-project-1"
export const PROJECT_NAME = "Harbor View Fit-out"
export const BOQ_ID = "lf-dl-boq-1"
export const VERIDIAN_PERSON_ID = "clfdeliveryperson000000001"
export const ORG_ID = "lf-dl-org-1"
const EPOCH = "lf-dl-epoch-1"

/** Today on the test machine's calendar ("YYYY-MM-DD"): the browser runs on the same machine and clock. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export const LONG_LINE_TEXT =
  "Gypsum partition, 12.5 mm board both sides on 70 mm steel studs at 600 centres, with 50 mm acoustic insulation, taped and jointed, Level 3 east wing"

type Row = Record<string, unknown> & { id: string }
export type Kinds = Record<string, Row[]>

/** One project's rows per kind, in the SQL column names the real projection uses (drizzle/0643). */
export function deliveryFixtures(): Kinds {
  const day = today()
  return {
    activities: [{ id: "act-1", category_id: null, name: "Interior fit-out", unit: "m2", planned_quantity: "1200", created_at: "2026-09-01T08:00:00Z" }],
    boq_lines: [
      { id: "dl-line-1", boq_id: BOQ_ID, activity_id: "act-1", item_code: "HV-101", description: LONG_LINE_TEXT, unit: "m2", quantity: "480", category: "Partitions", parent_line_item_id: null, created_at: "2026-09-01T08:00:00Z", rate: "85.50", amount: "41040.00" },
      { id: "dl-line-2", boq_id: BOQ_ID, activity_id: "act-1", item_code: "HV-102", description: "Ceiling paint, two coats", unit: "m2", quantity: "300", category: "Finishes", parent_line_item_id: null, created_at: "2026-09-01T08:00:00Z", rate: "12.00", amount: "3600.00" },
    ],
    progress: [
      { id: "prog-1", activity_id: "act-1", boq_line_item_id: "dl-line-1", entry_date: "2026-09-28", quantity_done: "48", percent_complete: "10", remarks: "East wing first fix", recorded_by_id: VERIDIAN_PERSON_ID, entry_basis: "DELTA", created_at: "2026-09-28T17:00:00Z" },
      { id: "prog-2", activity_id: "act-1", boq_line_item_id: "dl-line-2", entry_date: "2026-09-30", quantity_done: "45", percent_complete: "15", remarks: null, recorded_by_id: VERIDIAN_PERSON_ID, entry_basis: "DELTA", created_at: "2026-09-30T17:00:00Z" },
    ],
    roster: [
      { id: "w-1", name: "Ravi Kumar", trade: "carpenter", skill_level: "skilled", employee_code: "HV-W01", is_active: true, created_at: "2026-09-01T08:00:00Z", daily_rate: "950.00" },
      { id: "w-2", name: "Meena Pillai", trade: "painter", skill_level: "semi-skilled", employee_code: "HV-W02", is_active: true, created_at: "2026-09-01T08:00:00Z", daily_rate: "820.00" },
      { id: "w-3", name: "Joseph Dsouza", trade: "electrician", skill_level: "skilled", employee_code: "HV-W03", is_active: false, created_at: "2026-09-01T08:00:00Z", daily_rate: "1100.00" },
    ],
    attendance: [
      { id: "att-1", roster_id: "w-1", attendance_date: day, status: "present", hours_worked: "8", created_at: `${day}T09:00:00Z`, daily_cost: "950.00" },
      { id: "att-2", roster_id: "w-2", attendance_date: "2026-09-30", status: "half_day", hours_worked: "4", created_at: "2026-09-30T09:00:00Z", daily_cost: "410.00" },
    ],
    materials: [
      { id: "mat-1", name: "Gypsum board 12.5 mm", spec: "1200 x 2400", unit: "sheet", reorder_level: "20", is_active: true, created_at: "2026-09-01T08:00:00Z", unit_cost: "18.75" },
      { id: "mat-2", name: "Acrylic emulsion", spec: "white, 20 L", unit: "drum", reorder_level: "5", is_active: true, created_at: "2026-09-01T08:00:00Z", unit_cost: "142.00" },
    ],
    material_receipts: [
      { id: "rcp-1", material_id: "mat-1", received_date: "2026-09-25", quantity: "120", reference: "DN-4471", notes: null, voided_at: null, void_reason: null, created_at: "2026-09-25T10:00:00Z", unit_cost: "18.75", vendor_id: null },
      { id: "rcp-2", material_id: "mat-2", received_date: "2026-09-26", quantity: "10", reference: "DN-4502", notes: "Two drums dented", voided_at: null, void_reason: null, created_at: "2026-09-26T10:00:00Z", unit_cost: "142.00", vendor_id: null },
      // soft-deleted: a voided receipt stays on the list, struck through, and never counts as stock
      { id: "rcp-3", material_id: "mat-1", received_date: "2026-09-27", quantity: "40", reference: "DN-4519", notes: null, voided_at: "2026-09-27T12:00:00Z", void_reason: "Wrong board thickness", created_at: "2026-09-27T10:00:00Z", unit_cost: "18.75", vendor_id: null },
    ],
    material_issues: [
      { id: "iss-1", material_id: "mat-1", issued_date: "2026-09-29", quantity: "30", boq_line_item_id: "dl-line-1", issued_to: "Ravi Kumar", note: null, created_at: "2026-09-29T10:00:00Z" },
    ],
    tasks: [
      { id: "t-1", number: 1, title: "Partition framing", description: "Studs and tracks, Level 3", priority: "high", status_id: null, type_id: null, assignee_id: null, parent_issue_id: null, milestone_id: null, start_date: "2026-09-20", due_date: "2026-10-10", is_archived: false, completion_percentage: 40, created_by_id: null, created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-20T08:00:00Z" },
      { id: "t-2", number: 2, title: "Ceiling paint", description: null, priority: "medium", status_id: null, type_id: null, assignee_id: null, parent_issue_id: null, milestone_id: "ms-1", start_date: "2026-10-05", due_date: "2026-10-20", is_archived: false, completion_percentage: 0, created_by_id: null, created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-20T08:00:00Z" },
      // soft-deleted: an archived task is never shown
      { id: "t-3", number: 3, title: "Old mock-up wall", description: null, priority: "low", status_id: null, type_id: null, assignee_id: null, parent_issue_id: null, milestone_id: null, start_date: "2026-09-02", due_date: "2026-09-05", is_archived: true, completion_percentage: 100, created_by_id: null, created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-05T08:00:00Z" },
    ],
    milestones: [{ id: "ms-1", name: "Level 3 handover", description: null, status: "pending", target_date: "2026-11-15", created_at: "2026-09-01T08:00:00Z" }],
    schedule_baselines: [{ id: "bl-1", name: "Baseline A", captured_by_id: null, created_at: "2026-09-02T08:00:00Z" }],
  }
}

/** The money columns of each kind, hidden below the role that may see them (the redaction the real pull applies). */
const MONEY: Record<string, string[]> = {
  boq_lines: ["rate", "amount"],
  roster: ["daily_rate"],
  attendance: ["daily_cost"],
  materials: ["unit_cost"],
  material_receipts: ["unit_cost", "vendor_id"],
}

const READ_ONLY_ROLES = new Set(["viewer", "client_viewer", "external_auditor", "stage_0"])

export type Net = { mode: "up" | "down" | "offline" }
export type PushAnswer = "applied" | "rejected" | "conflict"
export type PushedOp = { op_id: string; function_id: string; project_id: string; params: Record<string, unknown>; record_kind?: string; client_at?: string }

export type DeliverySync = {
  /** "METHOD path" of every request answered, in order. */
  served: string[]
  /** Every op the laptop pushed, in arrival order (a re-send of the same op_id is recorded again: that is what "exactly once" checks). */
  pushes: PushedOp[]
  /** How the next op of a function is answered (default: applied). */
  answers: Map<string, { status: PushAnswer; code?: string }>
  /** The rows of the project as the server now holds them (fixtures + applied pushes). */
  rows: Kinds
}

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
})

const KIND_OF_FUNCTION: Record<string, string> = {
  record_attendance: "attendance",
  record_material_receipt: "material_receipts",
  record_material_issue: "material_issues",
  record_work_progress: "progress",
}

/** The row the server would make for an applied op (the server's own computed values, never the laptop's). */
function serverRowFor(op: PushedOp, rows: Kinds, id: string, at: string): Row | null {
  const p = op.params
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v))
  switch (op.function_id) {
    case "record_attendance": {
      const rate = num(rows.roster.find((w) => w.id === p.rosterId)?.daily_rate ?? 0)
      const factor = p.status === "absent" ? 0 : p.status === "half_day" ? 0.5 : 1
      return { id, roster_id: p.rosterId, attendance_date: p.date, status: p.status ?? "present", hours_worked: p.hours === undefined ? null : String(p.hours), created_at: at, daily_cost: (rate * factor).toFixed(2) }
    }
    case "record_material_receipt": {
      const cost = rows.materials.find((m) => m.id === p.materialId)?.unit_cost ?? null
      return { id, material_id: p.materialId, received_date: p.receivedDate, quantity: String(p.quantity), reference: p.reference ?? null, notes: p.notes ?? null, voided_at: null, void_reason: null, created_at: at, unit_cost: cost, vendor_id: null }
    }
    case "record_material_issue":
      return { id, material_id: p.materialId, issued_date: p.issuedDate, quantity: String(p.quantity), boq_line_item_id: p.boqLineItemId ?? null, issued_to: p.issuedTo ?? null, note: p.note ?? null, created_at: at }
    case "record_work_progress": {
      const line = rows.boq_lines.find((l) => l.id === p.boqLineItemId)
      const lineQty = num(line?.quantity ?? 0)
      const percent = typeof p.percent === "number" ? p.percent : lineQty > 0 ? Math.round((num(p.quantityDone) / lineQty) * 10000) / 100 : null
      const quantity = typeof p.quantityDone === "number" ? p.quantityDone : lineQty > 0 && typeof p.percent === "number" ? (p.percent / 100) * lineQty : null
      return {
        id, activity_id: rows.activities[0]?.id ?? null, boq_line_item_id: p.boqLineItemId, entry_date: p.entryDate, quantity_done: quantity === null ? null : String(quantity),
        percent_complete: percent === null ? null : String(percent), remarks: p.remarks ?? null, recorded_by_id: VERIDIAN_PERSON_ID, entry_basis: "DELTA", created_at: at,
      }
    }
    default:
      return null
  }
}

/**
 * More projects of the same person: "empty" holds every kind with no row (the screens' empty states); "unsynced" never finishes copying
 * (every pull of it answers 503, as a server under load would), so its screens must say "not finished copying" instead of an empty list.
 */
export type ExtraProject = { id: string; name: string; mode: "empty" | "unsynced" }

/** Answers the sync service for the main project from `rows` (and any extra projects); `role` decides the redaction. */
export async function stubDeliverySync(page: Page, who: LocalSession, net: Net, role: string, rows: Kinds = deliveryFixtures(), extra: ExtraProject[] = []): Promise<DeliverySync> {
  const sync: DeliverySync = { served: [], pushes: [], answers: new Map(), rows }
  const versions = new Map<string, number>()
  let made = 0
  const redact = READ_ONLY_ROLES.has(role)
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) })
  const item = (kind: string, r: Row) => {
    const hidden = redact ? (MONEY[kind] ?? []) : []
    const data: Row = { ...r }
    for (const f of hidden) if (f in data) data[f] = null
    return { id: r.id, updated_at: String(r.updated_at ?? r.created_at ?? "2026-09-01T08:00:00Z"), version: versions.get(`${kind}:${r.id}`) ?? 1, data }
  }

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"]
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) })
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused")
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length)
    sync.served.push(`${request.method()} ${path}`)
    const now = new Date().toISOString()
    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: VERIDIAN_PERSON_ID, auth_user_id: who.userId, name: "Asha Rao", role, org_id: ORG_ID },
        projects: [{ id: PROJECT_ID, name: PROJECT_NAME, status: "active" }, ...extra.map((p) => ({ id: p.id, name: p.name, status: "active" }))],
        kinds: Object.keys(rows).map((kind) => ({ kind, project_scoped: true, cursor_field: "created_at", deletes_supported: true })),
        view_class: redact ? "deliveryviewer01" : "deliverymember01",
        org_kinds: [], org_view_class: null,
        release: { current: null, min_compatible: null, protocol: 2 },
        server_time: now,
      })
    }
    // Audit 37: the shell now starts background + peer sync, which asks /attest; answer it quietly (an invalid body is ignored, a 404 would be a console error)
    if (request.method() === "POST" && path === "/attest") return json(route, origin, {})
    if (request.method() === "GET" && path === "/heads") {
      return json(route, origin, {
        heads: { [PROJECT_ID]: 0, ...Object.fromEntries(extra.map((p) => [p.id, 0])), __org__: 0 }, projects_etag: "lf-dl-projects-1", role, view_class: redact ? "deliveryviewer01" : "deliverymember01", org_view_class: null,
        epoch: EPOCH, server_time: now,
      })
    }
    if (request.method() === "POST" && path === "/pull") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string; ids?: string[] }
      const other = extra.find((p) => p.id === body.project_id)
      if (other?.mode === "unsynced") return json(route, origin, { error: "Service unavailable. Try again in a minute." }, 503)
      if (other && body.kind && body.kind in rows) {
        return json(route, origin, { items: [], kid: null, next_cursor: null, has_more: false, hidden_fields: [], redacted: false, server_time: now })
      }
      const list = body.kind ? rows[body.kind] : undefined
      if (body.project_id !== PROJECT_ID || !list) return json(route, origin, { error: "not found" }, 404)
      const chosen = body.ids ? list.filter((r) => body.ids!.includes(r.id)) : list
      return json(route, origin, {
        items: chosen.map((r) => item(body.kind!, r)),
        kid: null, next_cursor: null, has_more: false, hidden_fields: redact ? (MONEY[body.kind!] ?? []) : [], redacted: redact && Boolean(MONEY[body.kind!]), server_time: now,
      })
    }
    if (request.method() === "POST" && path === "/changes") {
      return json(route, origin, { changes: [], next_seq: 0, has_more: false, head_seq: 0, reset_required: false, epoch: EPOCH, server_time: now })
    }
    if (request.method() === "POST" && path === "/ids") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string }
      const other = extra.find((p) => p.id === body.project_id)
      if (other?.mode === "unsynced") return json(route, origin, { error: "Service unavailable. Try again in a minute." }, 503)
      const list = other ? [] : (body.kind && rows[body.kind]) || []
      const ids = list.map((r) => r.id)
      return json(route, origin, { ids, has_more: false, next_id: null, versions: list.map((r) => versions.get(`${body.kind}:${r.id}`) ?? 1), head_seq: 0, epoch: EPOCH, server_time: now })
    }
    if (request.method() === "POST" && path === "/push") {
      const body = request.postDataJSON() as { device_id?: string; ops?: PushedOp[] }
      const results = (body.ops ?? []).map((op) => {
        sync.pushes.push(op)
        const answer = sync.answers.get(op.function_id) ?? { status: "applied" as const }
        if (answer.status === "rejected") return { op_id: op.op_id, status: "rejected", error: { code: answer.code ?? "VALIDATION_FAILED" } }
        if (answer.status === "conflict") return { op_id: op.op_id, status: "conflict", version: 2, base_version: 1, server: null }
        const kind = KIND_OF_FUNCTION[op.function_id]
        made += 1
        const id = `srv-${made}`
        const row = kind ? serverRowFor(op, rows, id, now) : null
        if (kind && row) {
          rows[kind] = [...rows[kind], row]
          versions.set(`${kind}:${id}`, 1)
        }
        return { op_id: op.op_id, status: "applied", record_id: id, route: null, version: 1, server: null }
      })
      return json(route, origin, { results, server_time: now })
    }
    if (request.method() === "GET" && path === "/release/current") {
      return json(route, origin, { registered: true, current: null, min_compatible: null, protocol: 2, server_time: now })
    }
    if (request.method() === "POST" && path === "/release/register") return json(route, origin, { registered: true, server_time: now })
    if (request.method() === "POST" && path === "/install") return json(route, origin, { recorded: true, server_time: now })
    if (request.method() === "POST" && path === "/prepare") return json(route, origin, { recorded: true, server_time: now })
    return json(route, origin, { error: "not part of the local stub" }, 404)
  })
  return sync
}

/** The online page used for the one online "prepare" (the BOQ screen, the page lf-e8 proved): it needs only these /api answers. */
export const PREPARE_FIXTURE = {
  projectId: PROJECT_ID,
  boqId: BOQ_ID,
  boqTitle: "Harbor View - Fit-out",
  lines: [],
  header: { id: BOQ_ID, projectId: PROJECT_ID, version: 1, title: "Harbor View - Fit-out", status: "approved", parentBoqId: null, createdAt: "2026-09-01T00:00:00.000Z" },
} as unknown as ProjectFixture

export const DELIVERY_KIND_NAMES = Object.keys(deliveryFixtures())

// ─── what is really stored on the laptop ────────────────────────────────────────────────────────

export function readMeta(page: Page, dbName: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key)
          get.onerror = () => { db.close(); resolve(undefined) }
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value) }
        }
      }),
    { dbName, key }
  )
}

/** Every op waiting in this person's outbox (IndexedDB store `outbox` of projexa-local:<userId>), oldest first. */
export function readOutbox(page: Page, userId: string): Promise<Array<{ opId: string; functionId: string; params: Record<string, unknown>; status: string }>> {
  return page.evaluate(
    (dbName) =>
      new Promise((resolve) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("outbox")) { db.close(); resolve([]); return }
          const all = db.transaction("outbox", "readonly").objectStore("outbox").getAll()
          all.onerror = () => { db.close(); resolve([]) }
          all.onsuccess = () => {
            db.close()
            const ops = (all.result as Array<{ opId: string; functionId: string; params: Record<string, unknown>; status: string; seq?: number; clientAt?: string }>)
            resolve(ops.map((o) => ({ opId: o.opId, functionId: o.functionId, params: o.params, status: o.status })))
          }
        }
      }),
    `projexa-local:${userId}`
  )
}

// ─── getting a laptop into the "prepared" state, the way a person does ─────────────────────────

export type Prepared = { session: LocalSession; sync: DeliverySync; app: AppStub }

/** How long the first-run screen took to finish when a project could not be copied (ms), for the spec to assert on. */
export const prepareFinishedAfterMs: number[] = []

/** Signs in, opens the app online once (the first-run screen copies everything), and waits until every delivery kind is on the laptop. */
export async function prepareDeliveryLaptop(
  page: Page, context: BrowserContext, net: Net, role: string, expect: typeof import("@playwright/test").expect, extra: ExtraProject[] = []
): Promise<Prepared> {
  const session = await signInLocally(context, "delivery-spec@example.invalid")
  const sync = await stubDeliverySync(page, session, net, role, deliveryFixtures(), extra)
  const app = await stubAppApis(page, PREPARE_FIXTURE, session)
  await page.goto(`/scope/${BOQ_ID}`)
  if (extra.some((p) => p.mode === "unsynced")) {
    // a project that cannot be copied: by design the screen never says 100% then (prepare-workspace.ts), it FINISHES and says so
    const started = Date.now()
    await expect(page.getByTestId("workspace-prepare"), "the 'Preparing your PROJEXA workspace' screen never finished and opened PROJEXA").toHaveCount(0, { timeout: 240_000 })
    prepareFinishedAfterMs.push(Date.now() - started)
  } else {
    await expect(page.getByTestId("workspace-prepare"), "the 'Preparing your PROJEXA workspace' screen never finished and opened PROJEXA").toHaveCount(0, { timeout: 240_000 });
  }
  await expect
    .poll(() => readMeta(page, "projexa-local", "app:release"), { timeout: 240_000, message: "the release was never installed (meta app:release)" })
    .toMatchObject({ version: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/) })
  for (const kind of DELIVERY_KIND_NAMES) {
    await expect
      .poll(() => readMeta(page, `projexa-local:${session.userId}`, `sync:done:${PROJECT_ID}:${kind}`), { timeout: 120_000, message: `the ${kind} rows were never copied to the laptop` })
      .toBeTruthy()
  }
  await expect
    .poll(() => readMeta(page, "projexa-local", `shell:manifest:${session.userId}`), { timeout: 60_000, message: "the project names were never cached" })
    .toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ id: PROJECT_ID, name: PROJECT_NAME }), ...extra.map((p) => expect.objectContaining({ id: p.id, name: p.name }))]) })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" })
    .toBe(true)
  return { session, sync, app }
}

export function setNetwork(net: Net, app: AppStub, mode: Net["mode"]) {
  net.mode = mode
  app.setOffline(mode !== "up")
}

export async function goOffline(context: BrowserContext, net: Net, app: AppStub) {
  setNetwork(net, app, "offline")
  await context.setOffline(true)
}

export async function goOnline(context: BrowserContext, net: Net, app: AppStub) {
  setNetwork(net, app, "up")
  await context.setOffline(false)
}

// ─── a person at the screen ─────────────────────────────────────────────────────────────────────

type Expect = typeof import("@playwright/test").expect

/**
 * Next.js mounts ONE empty role="alert" (its route announcer, id __next-route-announcer__), and the outbox card (OutboxAttention) says a
 * turned-down change with role="alert" ON PURPOSE; any other alert or dialog is an error.
 */
export async function noCrash(page: Page, problems: string[], expect: Expect) {
  await expect(
    page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]:not(#__next-route-announcer__):not([data-testid="outbox-attention"] [role="alert"])'),
    "an error or dialog appeared"
  ).toHaveCount(0)
  await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0)
  await expect(page.getByTestId("local-shell-error"), "the shell could not read this screen").toHaveCount(0)
  expect(problems, "page errors / console errors").toEqual([])
}

/** Opens a shell path and waits for its screen in the given state. */
export async function openScreen(page: Page, path: string, testId: string, expect: Expect, state = "local") {
  await page.goto(`/local${path}`)
  await expect(page.getByTestId(testId)).toHaveAttribute("data-state", state)
}

/** Types like a person: one real keystroke at a time (the lf-e8 crash only showed on real keystrokes, never on `fill`). */
export async function typeInto(page: Page, label: string, text: string, expect: Expect) {
  const box = page.getByLabel(label, { exact: true })
  await box.click()
  await box.press("ControlOrMeta+a")
  await box.press("Backspace")
  await page.keyboard.type(text, { delay: 15 })
  await expect(box).toHaveValue(text)
}

/** A date the way a person types it into Chromium's date box (en-US segments: month, day, year), with real keystrokes. */
export async function typeDate(page: Page, label: string, iso: string, expect: Expect) {
  const box = page.getByLabel(label, { exact: true })
  const [y, m, d] = iso.split("-")
  // A native <input type="date"> takes keystrokes in the order of the BROWSER's own date format, and Chromium takes that from the
  // operating system's regional setting, NOT from Playwright's `locale` option (measured: a context with locale en-US / America/New_York on
  // a Windows machine set to en-IN still read "10032026" as 10 March). Typing month-day-year into a day-first field gave the
  // "2026-03-10 instead of 2026-10-03" the lf-delivery specs showed on a laptop with a non-US regional setting: a bug of this helper, not
  // of the app (the field's value is always ISO and the app reads exactly that). So: try each field order the browsers use, keep the first
  // that lands on the wanted day, and fall back to setting the value directly. The check below is still the wall.
  const orders: string[][] = [[m, d, y], [d, m, y], [y, m, d]]
  for (const order of orders) {
    await box.fill("")
    await box.focus()
    await page.keyboard.type(order.join(""), { delay: 15 })
    if ((await box.inputValue()) === iso) break
  }
  if ((await box.inputValue()) !== iso) await box.fill(iso)
  await expect(box).toHaveValue(iso)
}

/** Back online: the browser's switch, the stubs, and the person coming back to the tab. */
export async function backOnline(page: Page, context: BrowserContext, net: Net, app: AppStub) {
  await goOnline(context, net, app)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
}

// ─── console hygiene ────────────────────────────────────────────────────────────────────────────

/**
 * Collects page errors and console errors. Allowed: the favicon 404, and the network errors a browser itself logs for a request that
 * failed because the laptop is offline or the server is down (Chromium prints "Failed to load resource: net::ERR_INTERNET_DISCONNECTED"
 * / "net::ERR_CONNECTION_REFUSED" / "net::ERR_FAILED" for those). Anything else is a finding.
 */
export function watchConsole(page: Page) {
  const problems: string[] = []
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`))
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    const where = msg.location()?.url ?? ""
    if (/favicon\.ico/.test(where) || /favicon\.ico/.test(text)) return
    if (/Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|CONNECTION_REFUSED|FAILED)/.test(text)) return
    problems.push(`console.error: ${text}${where ? ` (${where})` : ""}`)
  })
  return problems
}
