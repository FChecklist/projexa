// lf-e7 test double: a SyncClient that serves project kinds AND organisation kinds the way the real handler does (drizzle/0684, 0686),
// with the person's ROLE deciding which organisation kinds exist for them and which fields are hidden, a view class per role, an epoch,
// and knobs for reset_required. It speaks the SyncClient interface directly (not HTTP): the wire itself is proven against the REAL
// handler in conformance/wire.integration.test.ts; this double exists so the replica's organisation and role rules can be tested fast
// and one at a time.
//
// The rules it models, as 0684 states them: a member (rank 2) and above reads every organisation kind; a viewer (rank 1) only
// cost_visibility (any other organisation kind is the ONE 404); vendors.credit_limit is null below a manager (rank 3) or when the
// organisation hides cost from managers; org_view_class is a fingerprint of exactly that; tasks.cost (a project kind) is null below a
// manager (view_class). Every row has a version (+1 per change) and every change a feed entry (deletes included).

import { ORG_PROJECT, SyncError, type ChangesPage, type HeadsAnswer, type IdsPage, type SyncChange, type SyncClient, type SyncManifest, type SyncPage } from "../sync-client";

export type Role = "viewer" | "member" | "manager";
const RANK: Record<Role, number> = { viewer: 1, member: 2, manager: 3 };
export const FAKE_ORG_KINDS = ["vendors", "departments", "org_people", "cost_visibility"] as const;
const ORG_MIN_RANK: Record<string, number> = { vendors: 2, departments: 2, org_people: 2, cost_visibility: 1 };

type Row = { id: string; updated_at: string; version: number; data: Record<string, unknown> };

export type FakeOrgServer = {
  client: SyncClient;
  role: Role;
  /** The organisation lets managers see cost (the cost_visibility config). */
  costVisible: boolean;
  epoch: string;
  /** Projects whose next /changes answers reset_required. */
  resetRequired: Set<string>;
  calls: Array<{ op: string; projectId?: string; kind?: string }>;
  upsert(projectId: string, kind: string, id: string, data: Record<string, unknown>): void;
  remove(projectId: string, kind: string, id: string): void;
  /** Versions restart (a rolled-back database): every row back to version 1, the log emptied, a new epoch. */
  restore(newEpoch: string): void;
  /** Turns off /heads (an older service answers 404). */
  noHeads: boolean;
};

export function createFakeOrgServer(o: { signInId: string; orgId?: string; projects?: string[]; role?: Role } ): FakeOrgServer {
  const orgId = o.orgId ?? "org-a";
  const projects = o.projects ?? ["p1", "p2"];
  const tables = new Map<string, Map<string, Map<string, Row>>>();
  const log = new Map<string, SyncChange[]>();
  let seq = 100;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 2, 10, 0, tick++)).toISOString();

  const table = (p: string, k: string) => {
    let byKind = tables.get(p);
    if (!byKind) tables.set(p, (byKind = new Map()));
    let rows = byKind.get(k);
    if (!rows) byKind.set(k, (rows = new Map()));
    return rows;
  };
  const feed = (p: string) => {
    let l = log.get(p);
    if (!l) log.set(p, (l = []));
    return l;
  };

  const s: FakeOrgServer = {
    role: o.role ?? "member",
    costVisible: true,
    epoch: "epoch-1",
    resetRequired: new Set(),
    calls: [],
    noHeads: false,
    upsert(p, k, id, data) {
      const rows = table(p, k);
      const prev = rows.get(id);
      const version = (prev?.version ?? 0) + 1;
      rows.set(id, { id, updated_at: stamp(), version, data: { id, org_id: orgId, ...data } });
      feed(p).push({ seq: ++seq, kind: k, id, version, op: prev ? "U" : "I" });
    },
    remove(p, k, id) {
      const rows = table(p, k);
      const prev = rows.get(id);
      if (!prev) return;
      rows.delete(id);
      feed(p).push({ seq: ++seq, kind: k, id, version: prev.version + 1, op: "D" });
    },
    restore(newEpoch) {
      for (const byKind of tables.values()) for (const rows of byKind.values()) for (const r of rows.values()) r.version = 1;
      log.clear();
      s.epoch = newEpoch;
    },
    client: null as unknown as SyncClient,
  };

  const rank = () => RANK[s.role];
  const orgReadable = (k: string) => (ORG_MIN_RANK[k] ?? 99) <= rank();
  const viewClass = () => `v-${rank() >= 3 ? "money" : "nomoney"}`;
  const orgViewClass = () => `ov-${rank()}-${rank() >= 3 && s.costVisible ? "cost" : "nocost"}`;
  const kindsOf = (p: string): string[] => (p === ORG_PROJECT ? FAKE_ORG_KINDS.filter(orgReadable) : ["tasks"]);
  const check = (p: string, k: string) => {
    if (p === ORG_PROJECT ? !orgReadable(k) || !(FAKE_ORG_KINDS as readonly string[]).includes(k) : !projects.includes(p) || k !== "tasks") {
      throw new SyncError("not_found", "That project or data kind is not available to you.", 404);
    }
  };
  /** What the server sends of a row for the current role (the SQL redaction). */
  const cut = (p: string, k: string, r: Row) => {
    const data = { ...r.data };
    if (p === ORG_PROJECT && k === "vendors" && !(rank() >= 3 && s.costVisible)) data.credit_limit = null;
    if (p !== ORG_PROJECT && k === "tasks" && rank() < 3) data.cost = null;
    return { id: r.id, updated_at: r.updated_at, version: r.version, data, sig: `sig:${p}:${k}:${r.id}:${r.version}` };
  };
  const pageOf = (p: string, items: ReturnType<typeof cut>[], next: string | null, more: boolean): SyncPage => ({
    items, kid: "k1", next_cursor: next, has_more: more, hidden_fields: [], redacted: false,
    ...(p === ORG_PROJECT ? { org_view_class: orgViewClass() } : { view_class: viewClass() }),
  });
  const headOf = (p: string) => feed(p).filter((c) => p !== ORG_PROJECT || orgReadable(c.kind)).reduce((m, c) => Math.max(m, c.seq), 0);

  s.client = {
    async manifest() {
      s.calls.push({ op: "manifest" });
      const m: SyncManifest = {
        user: { id: "veridian-1", auth_user_id: o.signInId, org_id: orgId, role: s.role },
        projects: projects.map((id) => ({ id })),
        kinds: [{ kind: "tasks", project_scoped: true, deletes_supported: true }],
        view_class: viewClass(),
        org_kinds: FAKE_ORG_KINDS.filter(orgReadable).map((kind) => ({ kind, project_scoped: false, deletes_supported: true, peer_shareable: kind !== "org_people" })),
        org_view_class: orgViewClass(),
      };
      return m;
    },
    async pull(req) {
      s.calls.push({ op: "pull", projectId: req.projectId, kind: req.kind });
      check(req.projectId, req.kind);
      const all = [...table(req.projectId, req.kind).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const after = typeof req.after === "string" ? req.after : null;
      const rest = after ? all.filter((r) => r.id > after) : all;
      const limit = req.limit ?? 500;
      const page = rest.slice(0, limit);
      const more = rest.length > limit;
      return pageOf(req.projectId, page.map((r) => cut(req.projectId, req.kind, r)), page.length ? page[page.length - 1]!.id : after, more);
    },
    async pullIds(req) {
      s.calls.push({ op: "pullIds", projectId: req.projectId, kind: req.kind });
      check(req.projectId, req.kind);
      const rows = table(req.projectId, req.kind);
      return pageOf(req.projectId, req.ids.map((id) => rows.get(id)).filter((r): r is Row => !!r).map((r) => cut(req.projectId, req.kind, r)), null, false);
    },
    async changes(req): Promise<ChangesPage> {
      s.calls.push({ op: "changes", projectId: req.projectId });
      if (req.projectId !== ORG_PROJECT && !projects.includes(req.projectId)) throw new SyncError("not_found", "Not found", 404);
      const head = headOf(req.projectId);
      if (req.afterSeq === null) return { changes: [], next_seq: head, has_more: false, head_seq: head, epoch: s.epoch };
      if (s.resetRequired.delete(req.projectId)) return { changes: [], next_seq: head, has_more: false, head_seq: head, epoch: s.epoch, reset_required: true };
      const allowed = new Set(kindsOf(req.projectId));
      const list = feed(req.projectId).filter((c) => c.seq > req.afterSeq! && allowed.has(c.kind));
      return { changes: list, next_seq: list.length ? list[list.length - 1]!.seq : req.afterSeq, has_more: false, head_seq: head, epoch: s.epoch };
    },
    async ids(req): Promise<IdsPage> {
      s.calls.push({ op: "ids", projectId: req.projectId, kind: req.kind });
      check(req.projectId, req.kind);
      return { ids: [...table(req.projectId, req.kind).keys()].sort(), has_more: false, next_id: null };
    },
    async push() {
      throw new SyncError("server", "not modelled");
    },
    async heads(): Promise<HeadsAnswer> {
      s.calls.push({ op: "heads" });
      if (s.noHeads) throw new SyncError("not_found", "Not found", 404);
      const heads: Record<string, number> = {};
      for (const p of projects) heads[p] = headOf(p);
      heads[ORG_PROJECT] = headOf(ORG_PROJECT);
      return { heads, projects_etag: "e", view_class: viewClass(), org_view_class: orgViewClass(), epoch: s.epoch };
    },
  };
  return s;
}

/** The fixture's organisation and project rows (a member's world). */
export function seedOrgWorld(s: FakeOrgServer): void {
  s.upsert(ORG_PROJECT, "vendors", "ven-1", { supplier_name: "Ace Cement", credit_limit: 500000 });
  s.upsert(ORG_PROJECT, "vendors", "ven-2", { supplier_name: "Bright Paints", credit_limit: 100000 });
  s.upsert(ORG_PROJECT, "departments", "dep-1", { name: "Site Execution" });
  s.upsert(ORG_PROJECT, "org_people", "u-mgr", { name: "Mira Manager", role: "manager", email: "m***@a.example.test" });
  s.upsert(ORG_PROJECT, "cost_visibility", "cv1", { role: "manager", can_see_cost: true });
  s.upsert("p1", "tasks", "t1", { title: "Pour slab", cost: 1200 });
  s.upsert("p1", "tasks", "t2", { title: "Shuttering", cost: 800 });
  s.upsert("p2", "tasks", "t9", { title: "Survey", cost: 50 });
}
