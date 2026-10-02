// One faithful, in-memory implementation of the server half of docs/local-first/CONTRACT.md, so the sync client,
// the replica and the outbox are all tested against the SAME fake instead of three hand-rolled ones (and so a later
// peer-to-peer test can reuse it). It speaks HTTP -- `fetchImpl` answers the real URLs with real Response objects --
// and `client` is the REAL createSyncClient pointed at it, so the client's own parsing, headers, retries and 426
// mapping are exercised too, not bypassed.
//
// WHAT IT MODELS (each point is the contract's, section number in brackets)
//   * rows with an integer `version` that goes up by one on every real change and an append-only change log with
//     a global `seq` [0, 1];
//   * the manifest, keyset pull (kinds WITH an updated_at cursor are ordered by (updated_at, id); kinds WITHOUT one
//     are ordered by id and so can never see a row change by cursor alone), pull by ids, /changes with tombstones,
//     /ids [1];
//   * push with an op ledger: applied / duplicate (same op_id answered again) / conflict (base_version older than the
//     head) / rejected / failed / needs_server, applied in order, 50 ops and 256 KB at most [2];
//   * a real ES256 signature over `px2|org|project|kind|id|version|updated_at|sha256(canonicalJSON(data))`, made with
//     WebCrypto, and `verifyRow` to check one [1];
//   * 426 for a release below the minimum [0].
//
// WHAT IT DOES NOT MODEL: authentication (any bearer token is accepted unless `signedOut` is set), role redaction beyond
// `hiddenFields`, rate limits, peers, jobs, the release bundle.
//
// KNOBS FOR FAILURE TESTS: loseNextResponses(n) (the server APPLIES the request and the answer never arrives),
// failNext({status}) (the request is refused before anything is applied), requireUpdate({...}) (426), signedOut,
// silent deletes (a delete that leaves no tombstone: what the reconcile exists for).

import { createSyncClient, type SyncClient } from "../sync-client";

export const FAKE_BASE_URL = "https://fake.sync.test/projexa-sync";

// ─── canonical JSON and the signed message (CONTRACT.md section 1) ────────────────────────────────────

/** JSON with object keys sorted at every level; arrays keep their order; `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedMessage(row: { org: string; project: string; kind: string; id: string; version: number; updated_at: string; data: unknown }): Promise<string> {
  return `px2|${row.org}|${row.project}|${row.kind}|${row.id}|${row.version}|${row.updated_at}|${await sha256Hex(canonicalJson(row.data))}`;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────

export type FakeKind = { kind: string; project_scoped?: boolean; /** "updated_at" (the default) or null for a table that has none. */ cursor_field?: "updated_at" | null };

type Row = { kind: string; id: string; projectId: string; data: Record<string, unknown>; version: number; updatedAt: string; deleted: boolean };
type Change = { seq: number; projectId: string; kind: string; id: string; version: number; op: "I" | "U" | "D" };

// `body` is whatever JSON the client sent (always an object for the POST routes); tests read its fields directly.
export type FakeRequest = { path: string; method: string; headers: Record<string, string>; body: any };

/** What a push function handler sees. */
export type FunctionContext = {
  server: FakeSyncServer;
  functionId: string;
  projectId: string;
  params: Record<string, unknown>;
  /** The row the op names (op.record), when it exists and is not deleted. */
  target: Row | null;
};
export type FunctionOutcome =
  | { ok: true; kind: string; id: string; data: Record<string, unknown>; route?: string }
  | { rejected: string; missing?: string[] }
  | { failed: string }
  | { needsServer: true };
export type FunctionHandler = (ctx: FunctionContext) => FunctionOutcome;

export type FakeServerOptions = {
  userId?: string;
  orgId?: string;
  role?: string;
  projects?: string[];
  kinds?: FakeKind[];
  /** Fields removed from every row's data, with `redacted: true` on the page (a role that may not see cost). */
  hiddenFields?: string[];
  release?: { current?: string; minCompatible?: string };
  /** Tombstones go in the change log (the default). false = the contract's "deletes made before change tracking existed". */
  trackDeletes?: boolean;
  /** applied/duplicate answers carry the resulting `server` row (false = only record_id/route/version, the narrower contract). */
  includeServerOnApplied?: boolean;
  keyId?: string;
};

export type FakeSyncServer = {
  readonly orgId: string;
  readonly userId: string;
  /** The REAL client, talking to this fake over its fetch. */
  client: SyncClient;
  fetchImpl: typeof fetch;
  requests: FakeRequest[];
  ledger: Map<string, { status: "applied"; record_id?: string; route?: string; version?: number }>;
  projects: string[];
  // seeding / simulating changes made by someone else
  upsert(input: { kind: string; projectId: string; id: string; data: Record<string, unknown>; updatedAt?: string; /** keep updated_at as it was (a table without one, or a write that does not touch it) */ touch?: boolean }): { version: number; updatedAt: string };
  remove(input: { kind: string; projectId: string; id: string; /** no tombstone in the change log */ silent?: boolean }): void;
  getRow(kind: string, id: string): { data: Record<string, unknown>; version: number; updatedAt: string; deleted: boolean } | undefined;
  headSeq(): number;
  tick(): string;
  // push functions
  registerFunction(functionId: string, handler: FunctionHandler): void;
  // knobs
  loseNextResponses(n: number): void;
  failNext(opts: { status: number; times?: number; path?: string }): void;
  requireUpdate(details: { current?: string; minCompatible?: string } | null): void;
  signedOut: boolean;
  /** Everything the server has stored for a push op id, newest last. */
  pushedOpIds(): string[];
  // signatures
  publicKey(): Promise<{ kid: string; jwk: JsonWebKey }>;
  verifyRow(row: { project: string; kind: string; id: string; version: number; updated_at: string; data: unknown; sig: string }): Promise<boolean>;
};

const START = Date.parse("2026-10-02T10:00:00Z");

// ─── the server ──────────────────────────────────────────────────────────────────────────────────────────────

export function createFakeSyncServer(opts: FakeServerOptions = {}): FakeSyncServer {
  const orgId = opts.orgId ?? "orgA";
  const userId = opts.userId ?? "u1";
  const kinds: FakeKind[] = opts.kinds ?? [
    { kind: "tasks" }, { kind: "boq_lines" }, { kind: "rfis" }, { kind: "progress", cursor_field: null },
  ];
  const kindSet = new Set(kinds.map((k) => k.kind));
  const kindOf = (kind: string) => kinds.find((k) => k.kind === kind);
  const trackDeletes = opts.trackDeletes !== false;
  const keyId = opts.keyId ?? "fake-key-1";

  const rows = new Map<string, Row>();
  const log: Change[] = [];
  let seq = 0;
  let clock = START;
  let idCounter = 0;
  let loseResponses = 0;
  let failure: { status: number; times: number; path?: string } | null = null;
  let update: { current?: string; minCompatible?: string } | null = null;
  const handlers = new Map<string, FunctionHandler>();
  const pushed: string[] = [];

  const tick = () => new Date((clock += 1000)).toISOString();
  const rowKey = (kind: string, id: string) => `${kind}:${id}`;

  // The signing key is made on first use so the factory stays synchronous.
  let keyPair: Promise<CryptoKeyPair> | null = null;
  const keys = () => (keyPair ??= crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>);
  async function sign(row: Row): Promise<string> {
    const message = await signedMessage({ org: orgId, project: row.projectId, kind: row.kind, id: row.id, version: row.version, updated_at: row.updatedAt, data: row.data });
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (await keys()).privateKey, new TextEncoder().encode(message));
    return b64url(new Uint8Array(sig));
  }

  function record(row: Row, op: "I" | "U" | "D") {
    seq += 1;
    log.push({ seq, projectId: row.projectId, kind: row.kind, id: row.id, version: row.version, op });
  }

  const hidden = new Set(opts.hiddenFields ?? []);
  const visible = (data: Record<string, unknown>) => (hidden.size ? Object.fromEntries(Object.entries(data).filter(([k]) => !hidden.has(k))) : data);

  async function wireRow(row: Row) {
    const data = visible(row.data);
    return {
      id: row.id, updated_at: row.updatedAt, version: row.version, data,
      // The signature covers exactly the data the client receives (a role's redaction is part of what is signed).
      sig: await sign({ ...row, data }),
    };
  }
  async function serverRow(row: Row) {
    const w = await wireRow(row);
    return { kind: row.kind, id: row.id, version: row.version, updated_at: row.updatedAt, data: w.data, sig: w.sig, kid: keyId };
  }

  const server: FakeSyncServer = {
    orgId, userId,
    projects: opts.projects ? [...opts.projects] : ["p1"],
    requests: [],
    ledger: new Map(),
    signedOut: false,
    client: undefined as unknown as SyncClient,
    fetchImpl: undefined as unknown as typeof fetch,

    tick,
    headSeq: () => seq,
    getRow(kind, id) {
      const r = rows.get(rowKey(kind, id));
      return r ? { data: r.data, version: r.version, updatedAt: r.updatedAt, deleted: r.deleted } : undefined;
    },
    upsert({ kind, projectId, id, data, updatedAt, touch }) {
      const existing = rows.get(rowKey(kind, id));
      const live = existing && !existing.deleted ? existing : undefined;
      const row: Row = {
        kind, id, projectId, data: { id, ...data },
        version: (existing?.version ?? 0) + 1,
        updatedAt: updatedAt ?? (live && touch === false ? live.updatedAt : tick()),
        deleted: false,
      };
      rows.set(rowKey(kind, id), row);
      record(row, live ? "U" : "I");
      return { version: row.version, updatedAt: row.updatedAt };
    },
    remove({ kind, projectId, id, silent }) {
      const existing = rows.get(rowKey(kind, id));
      if (!existing || existing.deleted) return;
      existing.deleted = true;
      existing.version += 1;
      existing.projectId = projectId;
      if (trackDeletes && !silent) record(existing, "D");
    },
    registerFunction(functionId, handler) { handlers.set(functionId, handler); },
    loseNextResponses(n) { loseResponses = n; },
    failNext(o) { failure = { status: o.status, times: o.times ?? 1, path: o.path }; },
    requireUpdate(details) { update = details; },
    pushedOpIds: () => [...pushed],
    async publicKey() {
      return { kid: keyId, jwk: await crypto.subtle.exportKey("jwk", (await keys()).publicKey) };
    },
    async verifyRow(row) {
      const message = await signedMessage({ org: orgId, project: row.project, kind: row.kind, id: row.id, version: row.version, updated_at: row.updated_at, data: row.data });
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, (await keys()).publicKey, fromB64url(row.sig), new TextEncoder().encode(message));
    },
  };

  // ─── the built-in push functions: the three the UI is wired to, plus one that creates progress ──────────────

  const need = (params: Record<string, unknown>, ...names: string[]): FunctionOutcome | null => {
    const missing = names.filter((n) => typeof params[n] !== "string" || !(params[n] as string).trim());
    return missing.length ? { rejected: "VALUE_REQUIRED", missing } : null;
  };
  handlers.set("create_rfi", ({ params, projectId }) => {
    const bad = need(params, "subject", "question");
    if (bad) return bad;
    idCounter += 1;
    const id = `srv-rfi-${idCounter}`;
    return {
      ok: true, kind: "rfis", id, route: `/rfis/${id}`,
      data: { id, projectId, number: idCounter, subject: params.subject, question: params.question, status: "open", ballInCourt: params.ballInCourt ?? "architect", answer: null, dueDate: params.dueDate ?? null },
    };
  });
  handlers.set("answer_rfi", ({ params, target }) => {
    if (!target) return { rejected: "RECORD_NOT_FOUND" };
    const bad = need(params, "answer");
    if (bad) return bad;
    return { ok: true, kind: "rfis", id: target.id, data: { ...target.data, answer: params.answer, status: "answered" } };
  });
  handlers.set("update_task", ({ params, target }) => {
    if (!target) return { rejected: "RECORD_NOT_FOUND" };
    if (typeof params.title === "string" && !params.title.trim()) return { rejected: "TITLE_REQUIRED", missing: ["title"] };
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "description", "statusId", "priority", "startDate", "dueDate", "completionPercentage"]) {
      if (key in params) patch[key] = params[key];
    }
    return { ok: true, kind: "tasks", id: target.id, data: { ...target.data, ...patch } };
  });
  handlers.set("record_work_progress", ({ params, projectId }) => {
    if (typeof params.percent !== "number" && typeof params.quantityDone !== "number") return { rejected: "VALUE_REQUIRED", missing: ["percent"] };
    idCounter += 1;
    const id = `srv-progress-${idCounter}`;
    return { ok: true, kind: "progress", id, route: `/work-progress/${id}`, data: { id, projectId, itemCode: params.itemCode, percent: params.percent ?? null } };
  });

  // ─── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const readable = (projectId: unknown) => typeof projectId === "string" && server.projects.includes(projectId);

  function sorted(projectId: string, kind: string): Row[] {
    const byUpdatedAt = kindOf(kind)?.cursor_field !== null;
    return [...rows.values()]
      .filter((r) => r.projectId === projectId && r.kind === kind && !r.deleted)
      .sort((a, b) => (byUpdatedAt ? a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id) : a.id.localeCompare(b.id)));
  }
  const cursorOf = (r: Row, kind: string) => (kindOf(kind)?.cursor_field !== null ? `${r.updatedAt}|${r.id}` : r.id);

  async function handlePull(body: Record<string, unknown>): Promise<Response> {
    const { project_id: projectId, kind } = body as { project_id: string; kind: string };
    if (!readable(projectId) || typeof kind !== "string" || !kindSet.has(kind)) return json({ error: "not found" }, 404);
    const redacted = hidden.size > 0;
    const common = { hidden_fields: [...hidden], redacted, server_time: new Date(clock).toISOString() };
    if (Array.isArray(body.ids)) {
      const ids = (body.ids as string[]).slice(0, 200);
      const items: Awaited<ReturnType<typeof wireRow>>[] = [];
      for (const id of ids) {
        const r = rows.get(rowKey(kind, id));
        if (r && !r.deleted && r.projectId === projectId) items.push(await wireRow(r));
      }
      return json({ items, kid: keyId, next_cursor: null, has_more: false, ...common });
    }
    const limit = Math.min(Number(body.limit) || 500, 500);
    const after = typeof body.after === "string" ? body.after : null;
    const list = sorted(projectId, kind).filter((r) => after === null || cursorOf(r, kind) > after);
    const page = list.slice(0, limit);
    const items: Awaited<ReturnType<typeof wireRow>>[] = [];
    for (const r of page) items.push(await wireRow(r));
    // "set whenever a page had rows; null for an empty page (keep the old one)"
    return json({ items, kid: keyId, next_cursor: page.length ? cursorOf(page[page.length - 1]!, kind) : null, has_more: list.length > page.length, ...common });
  }

  function handleChanges(body: Record<string, unknown>): Response {
    if (!readable(body.project_id)) return json({ error: "not found" }, 404);
    const head = log.length ? log[log.length - 1]!.seq : 0;
    if (body.after_seq === null) return json({ changes: [], next_seq: head, has_more: false, head_seq: head, server_time: new Date(clock).toISOString() });
    const after = Number(body.after_seq);
    const limit = Math.min(Number(body.limit) || 1000, 1000);
    const mine = log.filter((c) => c.projectId === body.project_id && c.seq > after && kindSet.has(c.kind));
    const page = mine.slice(0, limit);
    return json({
      changes: page.map((c) => ({ seq: c.seq, kind: c.kind, id: c.id, version: c.version, op: c.op })),
      next_seq: page.length ? page[page.length - 1]!.seq : after,
      has_more: mine.length > page.length,
      head_seq: head,
      server_time: new Date(clock).toISOString(),
    });
  }

  function handleIds(body: Record<string, unknown>): Response {
    if (!readable(body.project_id) || typeof body.kind !== "string" || !kindSet.has(body.kind)) return json({ error: "not found" }, 404);
    const limit = Math.min(Number(body.limit) || 5000, 5000);
    const after = typeof body.after_id === "string" ? body.after_id : null;
    const ids = [...rows.values()]
      .filter((r) => r.projectId === body.project_id && r.kind === body.kind && !r.deleted)
      .map((r) => r.id).sort().filter((id) => after === null || id > after);
    const page = ids.slice(0, limit);
    return json({ ids: page, has_more: ids.length > page.length, next_id: page.length ? page[page.length - 1] : null });
  }

  async function handlePush(body: Record<string, unknown>): Promise<Response> {
    const ops = Array.isArray(body.ops) ? (body.ops as Record<string, unknown>[]) : [];
    if (ops.length > 50 || JSON.stringify(body).length > 256 * 1024) return json({ error: "too large" }, 413);
    const results: unknown[] = [];
    for (const op of ops) {
      const opId = String(op.op_id);
      pushed.push(opId);
      const done = server.ledger.get(opId);
      if (done) { results.push({ op_id: opId, ...done, status: "duplicate", ...(opts.includeServerOnApplied ? { server: await currentServerRow(done) } : {}) }); continue; }

      const projectId = String(op.project_id);
      const handler = handlers.get(String(op.function_id));
      if (!handler) { results.push({ op_id: opId, status: "rejected", error: { code: "FUNCTION_NOT_AVAILABLE" } }); continue; }
      if (!readable(projectId)) { results.push({ op_id: opId, status: "rejected", error: { code: "PROJECT_NOT_REACHABLE" } }); continue; }

      const rec = op.record as { kind: string; id: string; base_version: number } | undefined;
      const target = rec ? rows.get(rowKey(rec.kind, rec.id)) : undefined;
      const live = target && !target.deleted && target.projectId === projectId ? target : null;
      if (rec && live && rec.base_version < live.version && op.resolution !== "overwrite") {
        results.push({ op_id: opId, status: "conflict", server: await serverRow(live) });
        continue;
      }
      const outcome = handler({ server, functionId: String(op.function_id), projectId, params: (op.params ?? {}) as Record<string, unknown>, target: live });
      if ("rejected" in outcome) { results.push({ op_id: opId, status: "rejected", error: { code: outcome.rejected, ...(outcome.missing ? { missing: outcome.missing } : {}) } }); continue; }
      if ("failed" in outcome) { results.push({ op_id: opId, status: "failed", error: { code: outcome.failed } }); continue; }
      if ("needsServer" in outcome) { results.push({ op_id: opId, status: "needs_server" }); continue; }

      const existing = rows.get(rowKey(outcome.kind, outcome.id));
      const row: Row = {
        kind: outcome.kind, id: outcome.id, projectId, data: outcome.data,
        version: (existing?.version ?? 0) + 1, updatedAt: tick(), deleted: false,
      };
      rows.set(rowKey(row.kind, row.id), row);
      record(row, existing && !existing.deleted ? "U" : "I");
      const stored = { status: "applied" as const, record_id: row.id, route: outcome.route, version: row.version };
      server.ledger.set(opId, stored);
      results.push({ op_id: opId, ...stored, ...(opts.includeServerOnApplied ? { server: await serverRow(row) } : {}) });
    }
    return json({ results, server_time: new Date(clock).toISOString() });
  }

  async function currentServerRow(done: { record_id?: string }) {
    for (const r of rows.values()) if (r.id === done.record_id) return serverRow(r);
    return undefined;
  }

  server.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(FAKE_BASE_URL.length);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    server.requests.push({ path, method: init?.method ?? "GET", headers, body });

    if (server.signedOut) return json({ error: "unauthorized" }, 401);
    if (update) return json({ error: "update required", current: update.current, min_compatible: update.minCompatible }, 426);
    if (failure && (!failure.path || failure.path === path) && failure.times > 0) {
      failure.times -= 1;
      return json({ error: "refused" }, failure.status);
    }

    let response: Response;
    if (path === "/manifest") {
      response = json({
        user: { id: userId, name: "Test User", role: opts.role ?? "member", org_id: orgId },
        projects: server.projects.map((id) => ({ id, name: `Project ${id}`, status: "active" })),
        kinds: kinds.map((k) => ({ kind: k.kind, project_scoped: k.project_scoped !== false, cursor_field: k.cursor_field === null ? null : "updated_at", deletes_supported: trackDeletes })),
        view_class: "0123456789abcdef",
        release: { current: opts.release?.current ?? "2026.10.02-3", min_compatible: opts.release?.minCompatible ?? "2026.10.01-1", protocol: 2 },
        server_time: new Date(clock).toISOString(),
      });
    } else if (path === "/pull") response = await handlePull(body);
    else if (path === "/changes") response = handleChanges(body);
    else if (path === "/ids") response = handleIds(body);
    else if (path === "/push") response = await handlePush(body);
    else response = json({ error: "no such route" }, 404);

    // The request WAS processed; the answer never arrives (a dropped connection after the server did its work).
    if (loseResponses > 0 && path === "/push") {
      loseResponses -= 1;
      throw new TypeError("network lost after the server applied the request");
    }
    return response;
  }) as typeof fetch;

  server.client = createSyncClient({
    getAccessToken: async () => "fake-token",
    baseUrl: FAKE_BASE_URL,
    fetchImpl: server.fetchImpl,
    sleep: async () => {},
    maxRetries: 0, // a lost response must surface to the OUTBOX (which owns the back-off), not be silently re-sent by the client
    getReleaseVersion: () => "2026.10.02-3",
  });
  return server;
}
