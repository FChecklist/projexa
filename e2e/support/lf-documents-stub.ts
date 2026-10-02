// lf-e10b. The sync service and the page's /api calls, answered INSIDE the browser (page.route) for the documents cluster (permits,
// drawings, documents, minutes of meetings) and the design/change cluster (change orders, the design studio's timesheets and tasks).
//
// SHAPES. Every answer is in the real service's shape (compliance-tracker supabase/functions/projexa-sync/handler.ts and
// docs/local-first/CONTRACT.md), as lf-e8 aligned them for e2e/offline-local-first.spec.ts:
//   * the manifest names the person by the VERIDIAN id in `user.id` and by the sign-in id in `user.auth_user_id`;
//   * rows are the AI work link's records_core projection (snake_case columns, compliance-tracker drizzle/0643 + 0677 + 0683);
//   * no signing key is configured, so rows are unsigned exactly as the real service sends them without one (`kid: null`, no `sig`);
//   * a role below the money rank gets money columns as NULL and their names in `hidden_fields` (`redacted: true`), as records_core does;
//   * /push answers one result per op: `applied` with a new version and `server: null` (handler.ts line ~1144), or what the spec asks
//     for (`conflict` with the server's version, `rejected` with an error code), and RECORDS every op so a spec can count them.
//
// "Offline" means both the browser's own switch (context.setOffline) and this stub refusing every request, because a route that
// fulfils a request answers even while the browser believes it is offline. "Down" refuses the sync service and /api with the
// browser online (our server down). Every name, id and figure below is made up.
import type { Page, Route } from "@playwright/test"
import { APP_ORIGIN, type LocalSession } from "./boq-local"

// Written out in full on purpose: the spec must fail if src/lib/local-first/sync-client.ts names a different address.
export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync"

export const PROJECT_ID = "lf-doc-project-1"
export const PROJECT_NAME = "Marina Heights Tower"
export const OTHER_PROJECT_ID = "lf-doc-project-2"
export const ORG_ID = "lf-doc-org-1"
/** The person's VERIDIAN id (compliance.users.id): what the server writes into timesheets.user_id. Not the sign-in id. */
export const VERIDIAN_PERSON_ID = "clfdocperson00000000000001"
export const EPOCH = "lf-doc-epoch-1"

export type Net = { mode: "up" | "down" | "offline" }

export type PushedOp = {
  op_id: string
  function_id: string
  project_id: string
  params: Record<string, unknown>
  record?: { kind: string; id: string; base_version: number }
  resolution?: string
  client_at: string
}

/** What the stub answers for one op. Default: applied. */
export type PushAnswer =
  | { status: "applied" }
  | { status: "conflict"; serverVersion: number; server?: Record<string, unknown> }
  | { status: "rejected"; code: string }

type Row = { id: string; updated_at: string; version: number; data: Record<string, unknown>; deleted?: boolean }

// ─── fixtures ───────────────────────────────────────────────────────────────────────────────────

/** Today in UTC (the timesheet's frame: design-studio-timesheet.ts todayIso), and a day relative to it, as YYYY-MM-DD. */
export const TODAY = new Date().toISOString().slice(0, 10)
export function dayFromToday(days: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const LONG_DOC_NAME =
  "Structural calculation package for the podium transfer slab, levels P1 to P3, including the post-tensioning tendon profiles, " +
  "punching shear checks at every column head and the revised deflection limits agreed with the consultant on site"
export const UNICODE_DOC_NAME = "Façade détail – 東京 office №7 (révision ü).pdf"

const DOC = (id: string, over: Record<string, unknown>): Row => ({
  id,
  updated_at: "2026-09-20T08:00:00Z",
  version: 3,
  data: {
    id, name: id, category: "report", file_type: "application/pdf", file_size: 245760, expiry_date: null, version_number: 1,
    is_latest_version: true, created_at: "2026-09-01T09:00:00Z", linked_entity_type: "project", linked_entity_id: PROJECT_ID, metadata: {},
    ...over,
  },
})

export const DOCUMENTS: Row[] = [
  DOC("lf-doc-safety", { name: "Site safety plan", category: "report", file_size: 245760, expiry_date: "2026-12-31", version_number: 2, created_at: "2026-09-10T09:00:00Z" }),
  // a long text, a unicode file name and null fields together on one document
  DOC("lf-doc-long", { name: LONG_DOC_NAME, category: null, file_type: null, file_size: null, expiry_date: null, version_number: null, is_latest_version: null, created_at: "2026-09-12T09:00:00Z" }),
  DOC("lf-doc-unicode", { name: UNICODE_DOC_NAME, category: "specification", file_type: "application/pdf", file_size: 3_355_443, created_at: "2026-09-11T09:00:00Z" }),
  // drawings are documents of category drawing (drizzle/0683): two revisions of one sheet
  DOC("lf-dwg-a101-c", {
    name: "A-101 Ground floor plan", category: "drawing", file_type: "application/pdf", file_size: 1_048_576, version_number: 3, created_at: "2026-09-15T09:00:00Z",
    metadata: { drawingNo: "A-101", rev: "C", status: "current", discipline: "Architectural", supersedesId: "lf-dwg-a101-b" },
  }),
  DOC("lf-dwg-a101-b", {
    name: "A-101 Ground floor plan", category: "drawing", file_type: "application/pdf", file_size: 1_000_000, version_number: 2, is_latest_version: false, created_at: "2026-09-05T09:00:00Z",
    metadata: { drawingNo: "A-101", rev: "B", status: "superseded", discipline: "Architectural" },
  }),
  // permits are documents of category permit
  DOC("lf-permit-dm", {
    name: "Building permit - podium", category: "permit", file_type: "application/pdf", file_size: 512_000, expiry_date: dayFromToday(180), created_at: "2026-09-02T09:00:00Z",
    metadata: { permitNumber: "DM-2026-0042", permitAuthority: "Dubai Municipality", issueDate: "2026-04-01" },
  }),
  DOC("lf-permit-hot", {
    name: "Hot works permit", category: "permit", file_type: "application/pdf", file_size: 64_000, expiry_date: dayFromToday(-1), created_at: "2026-09-03T09:00:00Z",
    metadata: { permitNumber: "HW-118", permitAuthority: "Civil Defence", issueDate: "2026-09-01" },
  }),
  // soft-deleted: the service sends the tombstone; it must not be shown
  { ...DOC("lf-doc-withdrawn", { name: "Withdrawn method statement", created_at: "2026-09-13T09:00:00Z" }), deleted: true },
]

export const MOMS: Row[] = [
  {
    id: "lf-mom-12", updated_at: "2026-09-21T10:00:00Z", version: 5,
    data: {
      id: "lf-mom-12", title: "Weekly site coordination #12", meeting_type: "site", scheduled_at: "2026-09-21T06:30:00Z", status: "draft", published_at: null,
      agenda: "Podium pour sequence\nFaçade mock-up approval\nCrane relocation", minutes: "Pour of zone B moved to Thursday.", attendee_count: 7, created_at: "2026-09-20T12:00:00Z",
    },
  },
  {
    id: "lf-mom-11", updated_at: "2026-09-14T10:00:00Z", version: 9,
    data: {
      id: "lf-mom-11", title: "Weekly site coordination #11", meeting_type: "site", scheduled_at: "2026-09-14T06:30:00Z", status: "published", published_at: "2026-09-15T09:00:00Z",
      agenda: ["Scaffold inspection"], minutes: "Scaffold passed inspection.", attendee_count: 5, created_at: "2026-09-13T12:00:00Z",
    },
  },
]

const CO = (id: string, over: Record<string, unknown>): Row => ({
  id, updated_at: "2026-09-18T08:00:00Z", version: 2,
  data: {
    id, number: 1, title: id, description: null, reason: null, cost_impact: null, schedule_impact_days: null, status: "draft", requested_by_id: null,
    approved_by_id: null, approved_at: null, trade: null, boq_revision_id: null, created_at: "2026-09-18T08:00:00Z", ...over,
  },
})

export const CHANGE_ORDERS: Row[] = [
  CO("lf-co-3", { number: 3, title: "Extra glazing to lobby", reason: "Client asked for a double-height curtain wall.", cost_impact: "18500.00", schedule_impact_days: 4, status: "draft", trade: "Glazing", created_at: "2026-09-18T08:00:00Z" }),
  CO("lf-co-2", { number: 2, title: "Omit feature ceiling", reason: "Value engineering.", cost_impact: "-2400.00", schedule_impact_days: -2, status: "approved", created_at: "2026-09-08T08:00:00Z" }),
]

export const TASKS: Row[] = [
  { id: "lf-task-7", updated_at: "2026-09-01T00:00:00Z", version: 1, data: { id: "lf-task-7", number: 7, title: "Lobby concept design", is_archived: false } },
  { id: "lf-task-8", updated_at: "2026-09-01T00:00:00Z", version: 1, data: { id: "lf-task-8", number: 8, title: "Joinery shop drawings", is_archived: false } },
]

export const TIMESHEETS: Row[] = [
  {
    // this person's own entry, written by the server with their VERIDIAN id (pipeline executors/timesheets.ts: actor.id)
    id: "lf-ts-1", updated_at: `${TODAY}T07:00:00Z`, version: 2,
    data: {
      id: "lf-ts-1", issue_id: "lf-task-7", user_id: VERIDIAN_PERSON_ID, hours: "3.5", spent_on: TODAY, activity_type: "Design", comments: null, billable: true,
      approval_status: "draft", created_at: `${TODAY}T07:00:00Z`, hourly_rate_snapshot: "95.00", invoice_item_id: null,
    },
  },
  {
    // a colleague's entry: never "mine"
    id: "lf-ts-2", updated_at: `${TODAY}T07:30:00Z`, version: 1,
    data: {
      id: "lf-ts-2", issue_id: "lf-task-8", user_id: "clfdoccolleague0000000001", hours: "6", spent_on: TODAY, activity_type: "Design", comments: null, billable: true,
      approval_status: "submitted", created_at: `${TODAY}T07:30:00Z`, hourly_rate_snapshot: "80.00", invoice_item_id: null,
    },
  },
]

/** Money columns of each kind (records_core): NULL and named in hidden_fields below the money rank. */
const MONEY: Record<string, string[]> = { change_orders: ["cost_impact"], timesheets: ["hourly_rate_snapshot", "invoice_item_id"] }

export const KIND_ROWS: Record<string, Row[]> = {
  documents: DOCUMENTS,
  meeting_minutes: MOMS,
  change_orders: CHANGE_ORDERS,
  tasks: TASKS,
  timesheets: TIMESHEETS,
}

/** ai_work_link__role_rank: who sees money (rank >= 3, manager and up). */
const ROLE_RANK: Record<string, number> = { viewer: 1, member: 2, site_engineer: 2, manager: 3, admin: 4, owner: 4 }
export const seesMoney = (role: string) => (ROLE_RANK[role] ?? 1) >= 3

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
})

export type SyncStub = {
  /** "METHOD /path" of every request the stub answered. */
  served: string[]
  /** Every op the laptop pushed, in order. */
  pushed: PushedOp[]
  /** Set an answer for the next op of a function (consumed once). */
  answerNext: (functionId: string, answer: PushAnswer) => void
}

/** The columns an applied update changes on its row, as the real executors write them (registry parameter -> records_core column). */
function columnsOf(op: PushedOp): Record<string, unknown> {
  const p = op.params
  const out: Record<string, unknown> = {}
  if (op.function_id === "update_document_metadata") {
    if (p.name !== undefined) out.name = p.name
    if (p.category !== undefined) out.category = p.category
    if (p.expiryDate !== undefined) out.expiry_date = p.expiryDate
  }
  if (op.function_id === "update_mom_minutes" && p.minutes !== undefined) out.minutes = p.minutes
  return out
}

export async function stubSyncService(page: Page, who: LocalSession, net: Net, role: string): Promise<SyncStub> {
  const stub: SyncStub = { served: [], pushed: [], answerNext: (fn, a) => { (answers[fn] ??= []).push(a) } }
  const answers: Record<string, PushAnswer[]> = {}
  const versions = new Map<string, number>()
  // What an applied op changed, per "kind:id" (this stub only: the fixtures are shared and never mutated). A pull after the push
  // returns the row as the real server would hold it then.
  const applied = new Map<string, Record<string, unknown>>()
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) })
  const now = () => new Date().toISOString()

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"]
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) })
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused")
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length)
    stub.served.push(`${request.method()} ${path}`)
    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: VERIDIAN_PERSON_ID, auth_user_id: who.userId, name: "Lina Haddad", role, org_id: ORG_ID },
        projects: [{ id: PROJECT_ID, name: PROJECT_NAME, status: "active" }],
        kinds: Object.keys(KIND_ROWS).map((kind) => ({ kind, project_scoped: true, cursor_field: "updated_at", deletes_supported: true })),
        view_class: `lf-doc-${role}`,
        org_kinds: [],
        org_view_class: null,
        release: { current: null, min_compatible: null, protocol: 2 },
        server_time: now(),
      })
    }
    if (request.method() === "GET" && path === "/heads") {
      return json(route, origin, {
        heads: { [PROJECT_ID]: 0, __org__: 0 }, projects_etag: "lf-doc-projects-1", role, view_class: `lf-doc-${role}`, org_view_class: null, epoch: EPOCH, server_time: now(),
      })
    }
    if (request.method() === "POST" && path === "/pull") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string; ids?: string[] }
      const all = body.kind ? KIND_ROWS[body.kind] : undefined
      if (body.project_id !== PROJECT_ID || !all) return json(route, origin, { error: "not found" }, 404)
      const hidden = seesMoney(role) ? [] : (MONEY[body.kind!] ?? [])
      const rows = body.ids ? all.filter((r) => body.ids!.includes(r.id)) : all
      return json(route, origin, {
        items: rows.map((r) => ({
          id: r.id, updated_at: r.updated_at, version: versions.get(`${body.kind}:${r.id}`) ?? r.version,
          data: { ...r.data, ...applied.get(`${body.kind}:${r.id}`), ...Object.fromEntries(hidden.map((f) => [f, null])) },
          ...(r.deleted ? { deleted: true } : {}),
        })),
        kid: null, next_cursor: null, has_more: false, hidden_fields: hidden, redacted: hidden.length > 0, server_time: now(),
      })
    }
    if (request.method() === "POST" && path === "/changes") {
      return json(route, origin, { changes: [], next_seq: 0, has_more: false, head_seq: 0, reset_required: false, epoch: EPOCH, server_time: now() })
    }
    if (request.method() === "POST" && path === "/ids") {
      const body = request.postDataJSON() as { kind?: string }
      const ids = (KIND_ROWS[body.kind ?? ""] ?? []).filter((r) => !r.deleted).map((r) => r.id).sort()
      return json(route, origin, { ids, has_more: false, next_id: null, versions: ids.map(() => 1), head_seq: 0, epoch: EPOCH, server_time: now() })
    }
    if (request.method() === "POST" && path === "/push") {
      const body = request.postDataJSON() as { device_id: string; ops: PushedOp[] }
      const results = body.ops.map((op) => {
        stub.pushed.push(op)
        const answer = answers[op.function_id]?.shift() ?? { status: "applied" as const }
        if (answer.status === "rejected") return { op_id: op.op_id, status: "rejected", error: { code: answer.code } }
        if (answer.status === "conflict") {
          return {
            op_id: op.op_id, status: "conflict", version: answer.serverVersion, base_version: op.record?.base_version ?? null,
            server: answer.server && op.record ? { kind: op.record.kind, id: op.record.id, version: answer.serverVersion, updated_at: now(), data: answer.server } : null,
          }
        }
        const key = op.record ? `${op.record.kind}:${op.record.id}` : `new:${op.op_id}`
        const version = (versions.get(key) ?? op.record?.base_version ?? 0) + 1
        versions.set(key, version)
        if (op.record) applied.set(key, { ...applied.get(key), ...columnsOf(op) })
        return { op_id: op.op_id, status: "applied", record_id: op.record?.id ?? `srv-${op.op_id.slice(0, 8)}`, route: null, version, server: null }
      })
      return json(route, origin, { results, server_time: now() })
    }
    if (request.method() === "GET" && path === "/release/current") {
      return json(route, origin, { registered: true, current: null, min_compatible: null, protocol: 2, server_time: now() })
    }
    if (request.method() === "POST" && path === "/release/register") return json(route, origin, { registered: true, server_time: now() })
    if (request.method() === "POST" && path === "/install") return json(route, origin, { recorded: true, server_time: now() })
    if (request.method() === "POST" && path === "/prepare") return json(route, origin, { recorded: true, server_time: now() })
    return json(route, origin, { error: "not part of the local stub" }, 404)
  })
  return stub
}

export type AppApiStub = { requests: string[]; setOffline: (offline: boolean) => void }

/**
 * Every /api call of the page (the online pages' own reads). Anything not listed gets an empty JSON object, which the online screens
 * read as "nothing to show". The shell bootstrap names the same person, organisation and project as the manifest.
 */
export async function stubAppApis(page: Page, who: LocalSession, net: Net, role: string): Promise<AppApiStub> {
  const app: AppApiStub = { requests: [], setOffline: () => {} }
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  await page.route("**/api/**", async (route, request) => {
    const url = new URL(request.url())
    if (url.origin !== APP_ORIGIN) return route.fallback()
    app.requests.push(`${request.method()} ${url.pathname}${url.search}`)
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused")
    if (request.method() !== "GET") return json(route, {})
    if (url.pathname === "/api/shell") {
      return json(route, {
        organization: { id: ORG_ID, name: "Haddad Contracting", slug: "haddad-contracting", country: "AE" },
        role, email: who.email, userId: who.userId,
        projects: [{ id: PROJECT_ID, name: PROJECT_NAME }],
        notifications: [], unreadCount: 0, pillUsage: [], recentChains: [], history: [], isNewUser: false, capabilityTree: [],
        currencies: [{ code: "AED", isBaseCurrency: true }], vendors: [], fetchedAt: Date.now(), errors: {},
      })
    }
    if (url.pathname === "/api/currencies") return json(route, { currencies: [{ code: "AED", isBaseCurrency: true }] })
    return json(route, {})
  })
  return app
}

// ─── reading what is really stored on the laptop ───────────────────────────────────────────────

/** The outbox ops stored in the person's own database (store "outbox"), straight from IndexedDB. */
export function readOutbox(page: Page, userId: string): Promise<Array<{ opId: string; functionId: string; params: Record<string, unknown>; status: string }>> {
  return page.evaluate(
    (userId) =>
      new Promise<Array<{ opId: string; functionId: string; params: Record<string, unknown>; status: string }>>((resolve) => {
        const open = indexedDB.open(`projexa-local:${userId}`)
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const db = open.result
          const name = ["outbox", "ops"].find((n) => db.objectStoreNames.contains(n))
          if (!name) { db.close(); resolve([]); return }
          const all = db.transaction(name, "readonly").objectStore(name).getAll()
          all.onerror = () => { db.close(); resolve([]) }
          all.onsuccess = () => { db.close(); resolve(all.result as never) }
        }
      }),
    userId,
  )
}

export function readPersonMeta(page: Page, userId: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ userId, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(`projexa-local:${userId}`)
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key)
          get.onerror = () => { db.close(); resolve(undefined) }
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value) }
        }
      }),
    { userId, key },
  )
}
