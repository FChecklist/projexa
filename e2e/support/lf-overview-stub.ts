// LOCAL-FIRST overview e2e (package lf-e10c): the stub of the sync service and of the page's /api calls for the dashboard, reports and
// analysis screens of the on-laptop shell. Everything is answered INSIDE the browser through page.route; nothing reaches Vercel, Supabase
// or any real network. Shapes are the real ones:
//   * the sync service: compliance-tracker supabase/functions/projexa-sync/handler.ts (manifest with user.id = the VERIDIAN id and
//     user.auth_user_id = the sign-in id; /heads; /pull keyset and by ids; /changes {changes[{seq,kind,id,version,op}], next_seq, has_more,
//     head_seq, reset_required, epoch}; /ids; unsigned rows carry kid: null) and docs/local-first/CONTRACT.md;
//   * the project dashboard: compliance-tracker src/app/api/v1/projexa/dashboard/[projectId]/route.ts, proxied by PROJEXA's
//     /api/dashboard/project/<id>. Below the manager rank the real route nulls every money field and adds `financialsRedacted: true`.
//
// The organisation has THREE projects. The person may read two; the third ("Marina Secret Annex") is in the server's data but NOT in the
// manifest, its /pull and /changes answer 404 like the real service, and every request that names it is recorded so a spec can assert
// that none was ever made. The stub's rows are the single source of truth: a spec computes every expected figure from `world.rows`
// itself, independently of the app's code.

import type { Page, Route } from "@playwright/test"

export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync"
export const APP_ORIGIN = `http://localhost:${Number(process.env.BOQ_LOCAL_PORT ?? 3117)}`

export const P1 = { id: "ov-p1-harbor", name: "Harbor View Tower" }
export const P2 = { id: "ov-p2-cedar", name: "Cedar Heights Villa" }
/** In the organisation, NOT readable by the person: never in the manifest, never served. */
export const P_SECRET = { id: "ov-p3-secret", name: "Marina Secret Annex" }

export const OVERVIEW_KINDS = ["tasks", "rfis", "punch_list", "submittals", "activities", "progress", "milestones", "change_orders", "progress_claims", "boq_lines"] as const
export type OverviewKind = (typeof OVERVIEW_KINDS)[number]

export type Row = Record<string, unknown> & { id: string }
type Stored = { row: Row; version: number; updatedAt: string }
type Change = { seq: number; kind: string; id: string; version: number; op: "I" | "U" | "D" }

export type Net = { mode: "up" | "down" | "offline" }

/** A role at or above "manager" sees money (compliance-tracker ROLE_RANK, hasFinancialVisibility). */
export type Role = "owner" | "manager" | "site_engineer" | "client_viewer"
const MONEY_ROLES: ReadonlySet<Role> = new Set(["owner", "manager"])

/** "YYYY-MM-DD", `offset` days from today, on the UTC calendar (the specs run the browser in UTC). */
export function dayFromToday(offset: number, now = Date.now()): string {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset)).toISOString().slice(0, 10)
}

const at = (n: number) => `2026-09-${String(1 + (n % 28)).padStart(2, "0")}T08:00:00Z`

/** The seeded rows of one readable project: several per kind, every state the dashboard counts, one row of every edge case. */
function seedHarbor(): Record<OverviewKind, Row[]> {
  return {
    tasks: [
      { id: "t1", title: "Pour level 3 slab", completion_percentage: 100, due_date: dayFromToday(-5), is_archived: false },
      { id: "t2", title: "Archived mock-up", completion_percentage: 50, due_date: dayFromToday(1), is_archived: true },
      { id: "t3", title: "Shoring removal", completion_percentage: 20, due_date: dayFromToday(-3), is_archived: false },
      { id: "t4", title: "Façade anchors, east elevation, levels 1 to 12, including the corner returns and the parapet", completion_percentage: 30, due_date: dayFromToday(2), is_archived: false },
      { id: "t5", title: "MEP first fix", completion_percentage: 0, due_date: dayFromToday(6), is_archived: false },
      { id: "t6", title: "Lift shaft survey", completion_percentage: 10, due_date: dayFromToday(7), is_archived: false },
      { id: "t7", title: "Snag walk", completion_percentage: 40, due_date: null, is_archived: false },
      { id: "t8", title: "Hoarding", completion_percentage: "100", due_date: dayFromToday(-1), is_archived: false },
    ],
    rfis: [
      { id: "r1", number: 1, subject: "Rebar clash at C4", status: "open" },
      { id: "r2", number: 2, subject: "Lobby finish", status: "open" },
      { id: "r3", number: 3, subject: "Fire stopping", status: "answered" },
      { id: "r4", number: 4, subject: "Door hardware", status: "open" },
      { id: "r5", number: 5, subject: "Ceiling void", status: "answered" },
      { id: "r6", number: 6, subject: "Kerb detail", status: "closed" },
    ],
    punch_list: [
      { id: "pl1", title: "Scuffed skirting", status: "open" },
      { id: "pl2", title: "Loose handrail", status: "in_progress" },
      { id: "pl3", title: "Cracked tile", status: "open" },
    ],
    submittals: [
      { id: "s1", number: 1, title: "Curtain wall shop drawings", status: "pending" },
      { id: "s2", number: 2, title: "Lift cab finishes", status: "approved" },
      { id: "s3", number: 3, title: "Sealant", status: "pending" },
      { id: "s4", number: 4, title: "Paint system", status: "rejected" },
    ],
    activities: [
      { id: "a1", name: "Substructure" },
      { id: "a2", name: "Frame" },
      { id: "a3", name: "Envelope" },
      { id: "a4", name: "Fit-out" },
    ],
    progress: [
      { id: "pe1", activity_id: "a1", percent_complete: 30, entry_date: dayFromToday(-20), created_at: at(1) },
      { id: "pe2", activity_id: "a1", percent_complete: 100, entry_date: dayFromToday(-10), created_at: at(2) },
      { id: "pe3", activity_id: "a2", percent_complete: 100, entry_date: dayFromToday(-9), created_at: at(3) },
      // a later entry corrects the frame back to 60%: the LATEST entry decides, not the highest
      { id: "pe4", activity_id: "a2", percent_complete: "60", entry_date: dayFromToday(-4), created_at: at(4) },
      { id: "pe5", activity_id: "a3", percent_complete: 10, entry_date: dayFromToday(-2), created_at: at(5) },
      // an entry of an activity that is not this project's: ignored
      { id: "pe6", activity_id: "a-elsewhere", percent_complete: 100, entry_date: dayFromToday(-1), created_at: at(6) },
    ],
    milestones: [
      { id: "m1", name: "Topping out", target_date: dayFromToday(1), status: "pending" },
      { id: "m2", name: "Dry-in", target_date: dayFromToday(3), status: "completed" },
      { id: "m3", name: "Handover", target_date: dayFromToday(10), status: "pending" },
      { id: "m4", name: "Scaffold strike", target_date: dayFromToday(-2), status: "pending" },
    ],
    change_orders: [
      { id: "co1", number: 1, title: "Extra basement sump", status: "draft", amount: "12500.00" },
      { id: "co2", number: 2, title: "Upgraded lobby stone", status: "approved", amount: "48000.00" },
      { id: "co3", number: 3, title: "Roof access hatch", status: "approved", amount: "3200.00" },
    ],
    progress_claims: [
      { id: "pc1", claim_number: 1, status: "submitted", amount: "250000.00" },
      { id: "pc2", claim_number: 2, status: "paid", amount: "180000.00" },
    ],
    boq_lines: [
      { id: "ov-line-1", boqId: "ov-boq-1", boqTitle: "Harbor View - Structure", boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null, itemCode: "HV-1", category: "", description: "Raft foundation", unit: "m3", quantity: "120", rate: "450.00", amount: "54000.00", createdAt: at(7) },
      { id: "ov-line-2", boqId: "ov-boq-1", boqTitle: "Harbor View - Structure", boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null, itemCode: "HV-2", category: "", description: "Core walls", unit: "m3", quantity: "80", rate: "520.00", amount: "41600.00", createdAt: at(8) },
    ],
  }
}

function seedCedar(): Record<OverviewKind, Row[]> {
  return {
    tasks: [
      { id: "c-t1", title: "Garden wall", completion_percentage: 0, due_date: null, is_archived: false },
      { id: "c-t2", title: "Pool shell", completion_percentage: 75, due_date: null, is_archived: false },
    ],
    rfis: [{ id: "c-r1", number: 1, subject: "Pool tiles", status: "open" }],
    punch_list: [],
    submittals: [],
    activities: [{ id: "c-a1", name: "Villa shell" }],
    progress: [],
    milestones: [],
    change_orders: [],
    progress_claims: [],
    boq_lines: [],
  }
}

/** The unreadable project's rows. If ANY of these ever reached the laptop, a count would include them: they are made to be noticed. */
function seedSecret(): Record<OverviewKind, Row[]> {
  const many = (prefix: string, n: number, extra: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, ...extra(i) }))
  return {
    tasks: many("x-t", 9, () => ({ title: "SECRET task", completion_percentage: 0, due_date: dayFromToday(1), is_archived: false })),
    rfis: many("x-r", 9, () => ({ subject: "SECRET rfi", status: "open" })),
    punch_list: many("x-pl", 9, () => ({ title: "SECRET", status: "open" })),
    submittals: [], activities: [], progress: [], milestones: [], change_orders: [], progress_claims: [], boq_lines: [],
  }
}

/** The server's figures for a project, as getProjectDashboard computes them (fixed numbers a spec asserts exactly). */
export const SERVER_FIGURES: Record<string, { progressPercent: number; percentByValue: number; contractValue: number; budget: number; expenses: number; delayedTaskCount: number; taskCount: number; permitsExpiringCount: number }> = {
  [P1.id]: { progressPercent: 47.5, percentByValue: 38.25, contractValue: 1250000, budget: 1100000, expenses: 1180000, delayedTaskCount: 1, taskCount: 8, permitsExpiringCount: 2 },
  [P2.id]: { progressPercent: 12, percentByValue: 5, contractValue: 640000, budget: 700000, expenses: 31000, delayedTaskCount: 0, taskCount: 2, permitsExpiringCount: 0 },
}

export type World = {
  role: Role
  /** Readable projects (the manifest's list), in order. */
  projects: { id: string; name: string }[]
  /** Every project's rows on the SERVER, the unreadable one included. */
  rows: Record<string, Record<OverviewKind, Stored[]>>
  /** Per project, the change feed. */
  feed: Record<string, Change[]>
  /** Requests that named the unreadable project (must stay empty). */
  secretRequests: string[]
  /** Every sync request served, "METHOD path [project kind]". */
  served: string[]
  /** Every /api request, "METHOD path?query". */
  api: string[]
  /** The BOQ line PATCHes the page sent (the shell writer's edits). */
  patches: { path: string; body: unknown }[]
  /** Adds (or changes) a row on the server and names it in the project's feed, as a colleague's edit would. */
  serverWrite(projectId: string, kind: OverviewKind, row: Row): void
  /** The rows of a readable project and kind as the server holds them now (what the laptop should end up with). */
  current(projectId: string, kind: OverviewKind): Row[]
}

export function createWorld(options: { role: Role; extraRows?: Partial<Record<OverviewKind, Row[]>> }): World {
  const toStored = (rows: Row[]): Stored[] => rows.map((row, i) => ({ row, version: 1, updatedAt: at(i) }))
  const build = (seed: Record<OverviewKind, Row[]>, extra?: Partial<Record<OverviewKind, Row[]>>) =>
    Object.fromEntries(OVERVIEW_KINDS.map((k) => [k, toStored([...seed[k], ...(extra?.[k] ?? [])])])) as Record<OverviewKind, Stored[]>
  const world: World = {
    role: options.role,
    projects: [P1, P2],
    rows: { [P1.id]: build(seedHarbor(), options.extraRows), [P2.id]: build(seedCedar()), [P_SECRET.id]: build(seedSecret()) },
    feed: { [P1.id]: [], [P2.id]: [], [P_SECRET.id]: [] },
    secretRequests: [],
    served: [],
    api: [],
    patches: [],
    serverWrite(projectId, kind, row) {
      const list = world.rows[projectId]![kind]
      const existing = list.find((s) => s.row.id === row.id)
      const feed = world.feed[projectId]!
      const seq = (feed.at(-1)?.seq ?? 0) + 1
      const updatedAt = new Date().toISOString()
      if (existing) {
        existing.row = row
        existing.version += 1
        existing.updatedAt = updatedAt
        feed.push({ seq, kind, id: row.id, version: existing.version, op: "U" })
      } else {
        list.push({ row, version: 1, updatedAt })
        feed.push({ seq, kind, id: row.id, version: 1, op: "I" })
      }
    },
    current: (projectId, kind) => world.rows[projectId]![kind].map((s) => s.row),
  }
  return world
}

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
})

/** The person's VERIDIAN id (a cuid), different from the sign-in id (CONTRACT.md "GET /manifest"). */
export const VERIDIAN_PERSON_ID = "clovspecperson000000000001"
const EPOCH = "ov-spec-epoch-1"
const PAGE = 500

/** Answers the sync service from `world`, in the real handler's shapes. */
export async function stubSyncService(page: Page, world: World, who: { userId: string; email: string }, net: Net): Promise<void> {
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) })
  const NOT_FOUND = { error: "Not found" }
  const readable = (projectId: unknown) => typeof projectId === "string" && world.projects.some((p) => p.id === projectId)
  const viewClass = MONEY_ROLES.has(world.role) ? "cls-money-0001" : "cls-nomoney-01"
  const heads = () => Object.fromEntries([...world.projects.map((p) => [p.id, world.feed[p.id]!.at(-1)?.seq ?? 0]), ["__org__", 0]])
  // what a role below manager does not get on a BOQ line (the real redaction hides the money columns and says which)
  const hidden = (kind: string) => (kind === "boq_lines" && !MONEY_ROLES.has(world.role) ? ["rate", "amount"] : [])
  const shape = (kind: string, s: Stored) => {
    const data = { ...s.row }
    for (const f of hidden(kind)) delete data[f]
    return { id: s.row.id, updated_at: s.updatedAt, version: s.version, data }
  }

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"]
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) })
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused")
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length)
    const body = request.method() === "POST" ? ((request.postDataJSON() ?? {}) as Record<string, unknown>) : {}
    world.served.push(`${request.method()} ${path}${body.project_id ? ` ${String(body.project_id)}` : ""}${body.kind ? ` ${String(body.kind)}` : ""}`)
    if (body.project_id === P_SECRET.id) {
      world.secretRequests.push(`${request.method()} ${path} ${JSON.stringify(body)}`)
      return json(route, origin, NOT_FOUND, 404)
    }
    const now = new Date().toISOString()
    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: VERIDIAN_PERSON_ID, auth_user_id: who.userId, name: "Asha Rao", role: world.role, org_id: "ov-org-1" },
        projects: world.projects.map((p) => ({ id: p.id, name: p.name, status: "active" })),
        kinds: OVERVIEW_KINDS.map((kind) => ({ kind, project_scoped: true, cursor_field: "updated_at", deletes_supported: true })),
        view_class: viewClass, org_kinds: [], org_view_class: null,
        release: { current: null, min_compatible: null, protocol: 2 }, server_time: now,
      })
    }
    if (request.method() === "GET" && path === "/heads") {
      return json(route, origin, { heads: heads(), projects_etag: "ov-projects-1", role: world.role, view_class: viewClass, org_view_class: null, epoch: EPOCH, server_time: now })
    }
    if (request.method() === "POST" && path === "/pull") {
      if (!readable(body.project_id) || !(OVERVIEW_KINDS as readonly unknown[]).includes(body.kind)) return json(route, origin, NOT_FOUND, 404)
      const kind = body.kind as OverviewKind
      const all = [...world.rows[body.project_id as string]![kind]].sort((a, b) => (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0))
      if (Array.isArray(body.ids)) {
        const want = new Set(body.ids as string[])
        return json(route, origin, { items: all.filter((s) => want.has(s.row.id)).map((s) => shape(kind, s)), kid: null, next_cursor: null, has_more: false, hidden_fields: hidden(kind), redacted: hidden(kind).length > 0, view_class: viewClass, server_time: now })
      }
      // keyset by id (the cursor is opaque to the client)
      const after = typeof body.after === "string" ? body.after : null
      const start = after === null ? 0 : all.findIndex((s) => s.row.id > after)
      const slice = start < 0 ? [] : all.slice(start, start + PAGE)
      const more = start >= 0 && start + PAGE < all.length
      return json(route, origin, { items: slice.map((s) => shape(kind, s)), kid: null, next_cursor: more ? slice.at(-1)!.row.id : null, has_more: more, hidden_fields: hidden(kind), redacted: hidden(kind).length > 0, view_class: viewClass, server_time: now })
    }
    if (request.method() === "POST" && path === "/changes") {
      if (!readable(body.project_id)) return json(route, origin, NOT_FOUND, 404)
      const feed = world.feed[body.project_id as string]!
      const head = feed.at(-1)?.seq ?? 0
      const afterSeq = typeof body.after_seq === "number" ? body.after_seq : null
      if (afterSeq === null) return json(route, origin, { changes: [], next_seq: head, has_more: false, head_seq: head, reset_required: false, epoch: EPOCH, server_time: now })
      const list = feed.filter((c) => c.seq > afterSeq)
      return json(route, origin, { changes: list, next_seq: list.at(-1)?.seq ?? afterSeq, has_more: false, head_seq: head, reset_required: false, epoch: EPOCH, server_time: now })
    }
    if (request.method() === "POST" && path === "/ids") {
      if (!readable(body.project_id) || !(OVERVIEW_KINDS as readonly unknown[]).includes(body.kind)) return json(route, origin, NOT_FOUND, 404)
      const list = world.rows[body.project_id as string]![body.kind as OverviewKind]
      return json(route, origin, { ids: list.map((s) => s.row.id), has_more: false, next_id: null, versions: list.map((s) => s.version), head_seq: world.feed[body.project_id as string]!.at(-1)?.seq ?? 0, epoch: EPOCH, server_time: now })
    }
    if (request.method() === "GET" && path === "/release/current") return json(route, origin, { registered: true, current: null, min_compatible: null, protocol: 2, server_time: now })
    if (request.method() === "POST" && path === "/release/register") return json(route, origin, { registered: true, server_time: now })
    if (request.method() === "POST" && path === "/install") return json(route, origin, { recorded: true, server_time: now })
    if (request.method() === "POST" && path === "/prepare") return json(route, origin, { recorded: true, server_time: now })
    return json(route, origin, { error: "not part of the local stub" }, 404)
  })
}

/** The 28-check exceptions answer of a project (only the shape the screen reads; three checks are enough to tell them apart). */
export function exceptionsBody(projectId: string) {
  if (projectId === P1.id) {
    return {
      checks: [
        { item: 1, title: "Tasks past their due date", flagged: true, count: 1, records: [{ id: "t3", detail: "Shoring removal is 3 days late" }] },
        { item: 2, title: "Spend above budget", flagged: true, count: 1, records: [{ id: P1.id, detail: "Spent 1,180,000.00 against a budget of 1,100,000.00" }] },
        { item: 3, title: "RFIs open for more than 14 days", flagged: false, count: 0, records: [] },
      ],
    }
  }
  return { checks: [{ item: 1, title: "Tasks past their due date", flagged: false, count: 0, records: [] }] }
}

/** GET /api/reports/boq-analysis's `{row}` for a project. */
export function boqAnalysisBody(projectId: string, role: Role) {
  const f = SERVER_FIGURES[projectId]!
  return MONEY_ROLES.has(role)
    ? { row: { projectName: projectId === P1.id ? P1.name : P2.name, contractValue: f.contractValue, cost: f.expenses, margin: f.contractValue - f.expenses } }
    : { row: { projectName: projectId === P1.id ? P1.name : P2.name, contractValue: null, cost: null, margin: null } }
}

/** GET of the "project-status" report: a list of projects as the server computed it. Only readable projects. */
export function projectStatusBody(world: World) {
  return world.projects.map((p) => ({ project: p.name, budget: MONEY_ROLES.has(world.role) ? SERVER_FIGURES[p.id]!.budget : null, spent: MONEY_ROLES.has(world.role) ? SERVER_FIGURES[p.id]!.expenses : null, overBudget: MONEY_ROLES.has(world.role) ? SERVER_FIGURES[p.id]!.expenses > SERVER_FIGURES[p.id]!.budget : null }))
}

export type AppStub = { setOffline(offline: boolean): void }

/**
 * Answers the page's /api calls. The overview endpoints answer the server's figures for the person's role (the real redaction below the
 * manager rank); an unreadable project is refused 404 like the real proxy; the BOQ line PATCH of the shell writer is recorded.
 */
export async function stubAppApis(page: Page, world: World, who: { userId: string; email: string }): Promise<AppStub> {
  const state = { offline: false }
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
  const readable = (id: string | null) => !!id && world.projects.some((p) => p.id === id)
  const money = MONEY_ROLES.has(world.role)

  await page.route("**/api/**", async (route, request) => {
    const url = new URL(request.url())
    if (url.origin !== APP_ORIGIN) return route.fallback()
    world.api.push(`${request.method()} ${url.pathname}${url.search}`)
    if (state.offline) return route.abort("internetdisconnected")
    const projectId = url.searchParams.get("projectId")
    if ((projectId ?? "").includes(P_SECRET.id) || url.pathname.includes(P_SECRET.id)) world.secretRequests.push(`api ${url.pathname}${url.search}`)
    if (request.method() === "PATCH" && url.pathname.startsWith("/api/scope/line-items/")) {
      const patch = request.postDataJSON() as { category?: string }
      world.patches.push({ path: url.pathname, body: patch })
      return json(route, { id: url.pathname.split("/").pop(), category: patch.category ?? null })
    }
    if (request.method() !== "GET") return json(route, {})
    const dash = /^\/api\/dashboard\/project\/([^/]+)$/.exec(url.pathname)
    if (dash) {
      const id = decodeURIComponent(dash[1]!)
      if (!readable(id)) return json(route, { error: "Project not found" }, 404)
      const f = SERVER_FIGURES[id]!
      const full = { projectId: id, ...f, revenue: null, projectValue: f.contractValue, earnedValue: f.contractValue * (f.percentByValue / 100), generatedAt: new Date().toISOString() }
      return json(route, money ? full : { ...full, budget: null, ledgerBudget: null, revenue: null, expenses: null, projectValue: null, earnedValue: null, percentByValue: null, contractValue: null, progressByBoqValuePct: null, financialsRedacted: true })
    }
    if (url.pathname === "/api/exceptions") return readable(projectId) ? json(route, exceptionsBody(projectId!)) : json(route, { error: "Project not found" }, 404)
    if (url.pathname === "/api/reports/boq-analysis") return readable(projectId) ? json(route, boqAnalysisBody(projectId!, world.role)) : json(route, { error: "Project not found" }, 404)
    if (url.pathname.startsWith("/api/reports/")) return readable(projectId) ? json(route, projectStatusBody(world)) : json(route, { error: "Project not found" }, 404)
    if (url.pathname === "/api/shell") {
      return json(route, {
        organization: { id: "ov-org-1", name: "Meridian Builders", slug: "meridian-builders", country: "AE" },
        role: world.role, email: who.email, userId: who.userId,
        projects: world.projects.map((p) => ({ id: p.id, name: p.name })),
        notifications: [], unreadCount: 0, pillUsage: [], recentChains: [], history: [], isNewUser: false, capabilityTree: [],
        currencies: [{ code: "AED", isBaseCurrency: true }], vendors: [], fetchedAt: Date.now(), errors: {},
      })
    }
    if (url.pathname === "/api/scope") return json(route, { boqs: [] })
    if (url.pathname === "/api/scope/categories") return json(route, { categories: [] })
    if (url.pathname === "/api/currencies") return json(route, { currencies: [{ code: "AED", isBaseCurrency: true }] })
    return json(route, {})
  })
  return { setOffline: (offline) => { state.offline = offline } }
}
