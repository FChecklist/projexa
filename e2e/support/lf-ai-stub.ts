// LOCAL-FIRST browser AI e2e (package lf-e11): the sync service and the page's /api calls, answered INSIDE the browser through page.route,
// in the shapes the real service sends (compliance-tracker supabase/functions/projexa-sync/handler.ts, docs/local-first/CONTRACT.md), for
// an organisation with several people of different roles and a person of ANOTHER organisation. Same arrangement as lf-e8's stub in
// e2e/offline-local-first.spec.ts: a production build, the local Auth stand-in (fake-supabase-server.mjs), nothing reaches a real network.
//
// What the "server" here decides, as the real one does (the laptop must never widen it):
//   * WHO: the manifest names the person by the sign-in id (user.auth_user_id) and their role; projects are only the ones they may read.
//   * WHAT: /pull of a project the person may not read, or of another organisation, is 404 {"error":"Not found"}.
//   * ROLE REDACTION: a role below the money rank (a viewer) gets money columns as null and `hidden_fields`, `redacted: true`.
//   * PUSH: every op is RECORDED (function_id, project_id, params, record) and answered `applied` with a server row, like the handler.
import type { BrowserContext, Page, Route } from "@playwright/test";
import { signInLocally, type LocalSession } from "./boq-local";

// Written out in full on purpose: the spec must fail if src/lib/local-first/sync-client.ts names a different address.
export const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";

export type Net = { mode: "up" | "down" | "offline" };

export type PersonKey = "member" | "manager" | "viewer" | "other_org";

export type Person = { key: PersonKey; email: string; veridianId: string; name: string; role: string; orgId: string; projects: { id: string; name: string }[]; actWithoutAsking?: boolean };

export const ORG_A = "lf-ai-org-a";
export const ORG_B = "lf-ai-org-b";
export const P1 = { id: "lf-ai-p1", name: "Harbor View Tower" };
export const P2 = { id: "lf-ai-p2", name: "Cedar Villa" };
/** A project of organisation A that the member may NOT read (not on their manifest; the server answers 404). */
export const P_HIDDEN = { id: "lf-ai-p-hidden", name: "Board Room Refit" };
export const Q1 = { id: "lf-ai-q1", name: "Other Org Mall" };

export const PEOPLE: Record<PersonKey, Person> = {
  member: { key: "member", email: "lf-ai-member@example.invalid", veridianId: "clfaimember000000000000001", name: "Asha Rao", role: "member", orgId: ORG_A, projects: [P1, P2] },
  manager: { key: "manager", email: "lf-ai-manager@example.invalid", veridianId: "clfaimanager00000000000001", name: "Ravi Menon", role: "manager", orgId: ORG_A, projects: [P1, P2, P_HIDDEN] },
  viewer: { key: "viewer", email: "lf-ai-viewer@example.invalid", veridianId: "clfaiviewer000000000000001", name: "Vina Shah", role: "viewer", orgId: ORG_A, projects: [P1] },
  other_org: { key: "other_org", email: "lf-ai-other@example.invalid", veridianId: "clfaiother0000000000000001", name: "Omar Haddad", role: "manager", orgId: ORG_B, projects: [Q1] },
};

export const KINDS = ["tasks", "rfis", "boq_lines", "documents", "material_receipts"] as const;
export type Kind = (typeof KINDS)[number];

/** Money columns per kind the server nulls for a role below the money rank (handler.ts def.money_columns). */
const MONEY: Partial<Record<Kind, string[]>> = { boq_lines: ["rate", "amount"], material_receipts: ["unit_cost"] };
const MONEY_RANK = 2; // member and above see money in this fixture; a viewer (rank 1) does not
const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3 };

type Row = { id: string; data: Record<string, unknown> };

/** The server's rows. Every text is distinct, so a leak of another project or organisation is visible by name. */
export const SERVER_ROWS: Record<string, Partial<Record<Kind, Row[]>>> = {
  [P1.id]: {
    tasks: [
      { id: "lf-ai-t1", data: { id: "lf-ai-t1", title: "Pour slab level 3", priority: "high", status_id: "s-open", completion_percentage: 20, start_date: "2026-10-01", due_date: "2026-10-09" } },
      { id: "lf-ai-t2", data: { id: "lf-ai-t2", title: "Fix scaffolding east side", priority: "low", status_id: "s-open", completion_percentage: 0, start_date: "2026-10-02", due_date: "2026-10-12" } },
    ],
    rfis: [{ id: "lf-ai-r1", data: { id: "lf-ai-r1", number: "RFI-001", subject: "Door hinge finish", question: "Brass or steel?", status: "open", answer: null } }],
    boq_lines: [{ id: "lf-ai-l1", data: { id: "lf-ai-l1", boq_id: "lf-ai-b1", item_code: "BW-01", description: "Blockwork 200mm", unit: "m2", quantity: "100", rate: "12.50", amount: "1250.00" } }],
    documents: [{ id: "lf-ai-d1", data: { id: "lf-ai-d1", name: "Old site survey", category: "survey", expiry_date: null } }],
    material_receipts: [{ id: "lf-ai-mr1", data: { id: "lf-ai-mr1", number: "GRN-7", material_id: "lf-ai-m1", quantity: 40, unit_cost: 410, received_date: "2026-09-30" } }],
  },
  [P2.id]: {
    tasks: [{ id: "lf-ai-t3", data: { id: "lf-ai-t3", title: "Paint villa lobby", priority: "medium", status_id: "s-open", completion_percentage: 0, start_date: "2026-10-03", due_date: "2026-10-20" } }],
  },
  [P_HIDDEN.id]: {
    tasks: [{ id: "lf-ai-th", data: { id: "lf-ai-th", title: "Board room secret task", priority: "high", status_id: "s-open", completion_percentage: 0 } }],
  },
  [Q1.id]: {
    tasks: [{ id: "lf-ai-q-t1", data: { id: "lf-ai-q-t1", title: "Other org mall task", priority: "high", status_id: "s-open", completion_percentage: 0 } }],
    rfis: [{ id: "lf-ai-q-r1", data: { id: "lf-ai-q-r1", subject: "Other org hinge", question: "?", status: "open", answer: null } }],
  },
};

export type PushedOp = { op_id: string; function_id: string; project_id: string; params: Record<string, unknown>; record?: { kind: string; id: string; base_version: number }; by: string };

export type SyncStub = {
  /** Every request served, "METHOD /path" (+ project for a pull). */
  served: string[];
  /** Every DISTINCT op (by op_id) the server received and ran, in order, with the sign-in id that sent it. */
  pushed: PushedOp[];
  /** Ops sent again with an op_id already received (answered `duplicate`, nothing ran): the laptop's retry after a lost answer. */
  resent: PushedOp[];
  /** Pull requests the stub REFUSED with 404 (a project or organisation the person may not read). */
  refusedPulls: { by: string; project: string; kind: string }[];
};

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
});

const EPOCH = "lf-ai-epoch-1";

function subOf(authorization: string | undefined): string | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    return (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/** The rows of a project as the person's role may see them (the server's redaction, never the laptop's). */
function rowsFor(person: Person, projectId: string, kind: Kind): { items: Row[]; hidden: string[] } {
  const rows = SERVER_ROWS[projectId]?.[kind] ?? [];
  const money = MONEY[kind] ?? [];
  if ((RANK[person.role] ?? 0) >= MONEY_RANK || money.length === 0) return { items: rows, hidden: [] };
  return { items: rows.map((r) => ({ id: r.id, data: { ...r.data, ...Object.fromEntries(money.map((m) => [m, null])) } })), hidden: money };
}

/**
 * Answers the sync service for whichever signed-in person the bearer token names (`people` maps sign-in ids to people). A person may be
 * added after the stub is installed (a second person signs in on the same laptop).
 */
export async function stubSync(page: Page | BrowserContext, people: Map<string, Person>, net: Net): Promise<SyncStub> {
  const stub: SyncStub = { served: [], pushed: [], resent: [], refusedPulls: [] };
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
  let seq = 0;
  // What the server would hold after the applied pushes: a real pull returns the person's own created/changed rows, so the stub must too
  // (otherwise the next pull puts the fixture back over a change the server had accepted, and the screen loses the AI's work).
  const applied = new Map<string, Map<string, Row>>();
  // The change feed of those pushes (seq per project): a pull or reconcile that was already in flight when a push settled can miss the new
  // row; the real service's feed hands it over on the next pass, so the stub's must too.
  const feed = new Map<string, { seq: number; kind: string; id: string; version: number; op: "I" | "U" }[]>();
  const serverRows = (person: Person, projectId: string, kind: Kind): { items: Row[]; hidden: string[] } => {
    const base = rowsFor(person, projectId, kind);
    const extra = applied.get(`${projectId}|${kind}`);
    if (!extra) return base;
    const items = base.items.map((r) => (extra.has(r.id) ? { ...r, data: { ...r.data, ...extra.get(r.id)!.data } } : r));
    for (const r of extra.values()) if (!items.some((i) => i.id === r.id)) items.push(r);
    return { items, hidden: base.hidden };
  };

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) });
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused");
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length);
    const sub = subOf(request.headers()["authorization"]);
    const person = sub ? people.get(sub) : undefined;
    if (!sub || !person) return json(route, origin, { error: "Unauthorized" }, 401);
    const readable = new Set(person.projects.map((p) => p.id));
    stub.served.push(`${request.method()} ${path}`);
    const now = new Date().toISOString();

    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: person.veridianId, auth_user_id: sub, name: person.name, role: person.role, org_id: person.orgId, ...(person.actWithoutAsking ? { ai_act_without_asking: true } : {}) },
        projects: person.projects.map((p) => ({ id: p.id, name: p.name, status: "active" })),
        kinds: KINDS.map((kind) => ({ kind, project_scoped: true, cursor_field: "updated_at", deletes_supported: false })),
        view_class: person.role === "viewer" ? "00000000000000v1" : "00000000000000m3",
        org_kinds: [], org_view_class: null,
        release: { current: null, min_compatible: null, protocol: 2 },
        server_time: now,
      });
    }
    if (request.method() === "GET" && path === "/heads") {
      return json(route, origin, {
        heads: Object.fromEntries([...person.projects.map((p) => [p.id, 0]), ["__org__", 0]]), projects_etag: `lf-ai-${person.key}`, role: person.role,
        view_class: person.role === "viewer" ? "00000000000000v1" : "00000000000000m3", org_view_class: null, epoch: EPOCH, server_time: now,
      });
    }
    if (request.method() === "POST" && path === "/pull") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string; ids?: string[] };
      const project = body.project_id ?? "";
      const kind = body.kind as Kind;
      if (!readable.has(project) || !(KINDS as readonly string[]).includes(kind)) {
        stub.refusedPulls.push({ by: sub, project, kind: String(body.kind) });
        return json(route, origin, { error: "Not found" }, 404);
      }
      const { items, hidden } = serverRows(person, project, kind);
      const rows = body.ids ? items.filter((r) => body.ids!.includes(r.id)) : items;
      return json(route, origin, {
        items: rows.map((r) => ({ id: r.id, updated_at: "2026-10-01T00:00:00Z", version: 1, data: r.data })),
        kid: null, next_cursor: null, has_more: false, hidden_fields: hidden, redacted: hidden.length > 0, server_time: now,
      });
    }
    if (request.method() === "POST" && path === "/changes") {
      const body = request.postDataJSON() as { project_id?: string; after_seq?: number | null };
      const log = feed.get(body.project_id ?? "") ?? [];
      const after = typeof body.after_seq === "number" ? body.after_seq : 0;
      const changes = log.filter((c) => c.seq > after);
      const head = log.length ? log[log.length - 1]!.seq : 0;
      return json(route, origin, { changes, next_seq: Math.max(after, head), has_more: false, head_seq: head, reset_required: false, epoch: EPOCH, server_time: now });
    }
    if (request.method() === "POST" && path === "/ids") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string };
      if (!readable.has(body.project_id ?? "")) return json(route, origin, { error: "Not found" }, 404);
      const ids = (serverRows(person, body.project_id!, body.kind as Kind).items).map((r) => r.id);
      return json(route, origin, { ids, has_more: false, next_id: null, versions: ids.map(() => 1), head_seq: (feed.get(body.project_id!) ?? []).length, epoch: EPOCH, server_time: now });
    }
    if (request.method() === "POST" && path === "/push") {
      const body = request.postDataJSON() as { device_id: string; ops: PushedOp[] };
      const results = body.ops.map((op) => {
        // The handler's push ledger (exactly-once by op_id): an op sent again -- its first answer was lost, e.g. the page navigated
        // away mid-request -- runs nothing and is answered `duplicate`. Only the first send of an op_id counts as a write.
        const first = stub.pushed.find((p) => p.op_id === op.op_id && p.by === sub);
        if (first) {
          stub.resent.push({ ...op, by: sub });
          return { op_id: op.op_id, status: "duplicate", record_id: first.record?.id ?? null, route: null, version: (first.record?.base_version ?? 0) + 1 };
        }
        stub.pushed.push({ ...op, by: sub });
        // The handler's own shape check (handler.ts checkOp): a project the person may not read is refused, nothing runs.
        if (!readable.has(op.project_id)) return { op_id: op.op_id, status: "rejected", error: { code: "NOT_FOUND" } };
        seq += 1;
        const kind = op.record?.kind ?? (op.function_id === "create_rfi" ? "rfis" : op.function_id === "create_schedule_task" ? "tasks" : null);
        const id = op.record?.id ?? `lf-ai-srv-${seq}`;
        if (kind) {
          const { projectId: _p, issueId: _i, ...changed } = op.params as Record<string, unknown>;
          const key = `${op.project_id}|${kind}`;
          const bucket = applied.get(key) ?? new Map<string, Row>();
          const before = bucket.get(id);
          bucket.set(id, { id, data: { ...(before?.data ?? {}), ...(op.record ? {} : { id }), ...changed } });
          applied.set(key, bucket);
          const log = feed.get(op.project_id) ?? [];
          log.push({ seq: log.length + 1, kind, id, version: (op.record?.base_version ?? 0) + 1, op: op.record ? "U" : "I" });
          feed.set(op.project_id, log);
        }
        return {
          op_id: op.op_id, status: "applied", record_id: id, route: null, version: (op.record?.base_version ?? 0) + 1,
          ...(kind ? { server: { kind, id, version: (op.record?.base_version ?? 0) + 1, updated_at: now, data: { id, ...op.params } } } : {}),
        };
      });
      return json(route, origin, { results, server_time: now });
    }
    if (request.method() === "GET" && path === "/release/current") return json(route, origin, { registered: true, current: null, min_compatible: null, protocol: 2, server_time: now });
    if (request.method() === "POST" && path === "/release/register") return json(route, origin, { registered: true, server_time: now });
    if (request.method() === "POST" && path === "/install") return json(route, origin, { recorded: true, server_time: now });
    return json(route, origin, { error: "not part of the local stub" }, 404);
  });
  return stub;
}

/** Answers every /api call of the page with what the shell needs to draw itself, for the person signed in. Everything else: {}. */
export async function stubAppApis(page: Page | BrowserContext, appOrigin: string, current: () => { person: Person; session: LocalSession }, net: Net): Promise<string[]> {
  const requests: string[] = [];
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async (route, request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin) return route.fallback();
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused");
    const { person, session } = current();
    if (url.pathname === "/api/shell") {
      return json(route, {
        organization: { id: person.orgId, name: person.orgId === ORG_A ? "Harbor Builders" : "Other Org Ltd", slug: person.orgId, country: "AE" },
        role: person.role, email: person.email, userId: session.userId, projects: person.projects,
        notifications: [], unreadCount: 0, pillUsage: [], recentChains: [], history: [], isNewUser: false, capabilityTree: [],
        currencies: [{ code: "AED", isBaseCurrency: true }], vendors: [], fetchedAt: Date.now(), errors: {},
      });
    }
    if (url.pathname === "/api/currencies") return json(route, { currencies: [{ code: "AED", isBaseCurrency: true }] });
    return json(route, {});
  });
  return requests;
}

/** Signs a made-up person in (the local Auth stand-in) and registers them with the stub. */
export async function signIn(context: BrowserContext, people: Map<string, Person>, person: Person): Promise<LocalSession> {
  const session = await signInLocally(context, person.email);
  people.set(session.userId, person);
  return session;
}
