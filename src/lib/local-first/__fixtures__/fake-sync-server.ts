// One in-memory implementation of the PROJEXA sync service, so the sync client, the replica and the outbox are all tested against the
// SAME fake instead of three hand-rolled ones. It speaks HTTP -- `fetchImpl` answers the real URLs with real Response objects -- and
// `client` is the REAL createSyncClient pointed at it, so the client's own parsing, headers, retries and 426 mapping are exercised too.
//
// REBUILT FROM THE REAL HANDLER (review TEST-09, package FA, 2026-10-02). The first version was written from the contract text and hid real
// defects: it used one id for the person's sign-in and their VERIDIAN id (so every real sync's user_mismatch never showed), had no body cap
// (so a 413 that wedged a project never showed), answered statuses and keys the real service never sends. This version follows
// compliance-tracker `supabase/functions/projexa-sync/handler.ts` and the SQL behind it (drizzle/0677-0681) line by line where it matters,
// and src/lib/local-first/conformance/parity.test.ts runs the same scenarios against this fake and (with CT_ROOT) against the real handler,
// asserting equal observable client state. Where they differ, the real handler is right and this file is the bug.
//
// WHAT IT MODELS, as the real service does
//   * identity: the token's subject (`userId`, the SIGN-IN id the laptop knows) and the VERIDIAN person id (`veridianUserId`, a cuid, a
//     DIFFERENT string) both travel in the manifest: `user.id` is the VERIDIAN id, `user.auth_user_id` the sign-in id;
//   * caps: non-push bodies over 4,096 characters -> 413, push over 256 KB -> 413, 1..50 ops, ids 1..200 matching the id rule, page limits,
//     cursor checks -> 400; 120 requests a minute per person -> 429 with Retry-After: 60 (on the injected `now`); unknown route -> 404,
//     wrong method -> 405; an unknown or unreadable project or kind -> ONE 404 {error:"Not found"};
//   * rows with an integer `version` (+1 per real change, deletes included) and a per-project change log with a global `seq`; keyset pull
//     ordered by (updated_at|created_at, id) with an opaque base64url cursor (default page 200, max 500); pull by ids; /changes (after_seq
//     null -> head only; next_seq = last seq of the page or after_seq); /ids;
//   * role redaction as the real second money pass does it: a hidden field is set to null and the row carries `redacted: true`;
//   * push as drizzle/0681 decides it: BAD_OP (shape, op_id 8..128 chars, record shape, params over 64 KB), FUNCTION_NOT_ALLOWED (no such
//     write), ROLE_TOO_LOW (`deniedFunctions`), PROJECT_NOT_READABLE, OP_ID_REUSED (same op_id, other content), duplicate (applied: the
//     stored record_id/route/version, NO server row; rejected: the stored code again), CONFLICT whenever the head version is above the
//     op's base_version -- a deleted row included (then `server: null`) -- whatever `resolution` says; applied answers carry the signed
//     `server` row; a record whose op did not apply holds its later ops in the batch (failed PREVIOUS_OP_BLOCKED); device_id 8..64 chars.
//     Three of these keep a legacy default for package FB's outbox.test.ts: see the `strict` option (always pass it in new tests);
//   * the release gate: 426 UPDATE_REQUIRED when X-Px-Client names another protocol, or a release matching YYYY.MM.DD-NNN below the
//     floor; a release that does not match (dev, a commit sha) is never gated;
//   * a real ES256 signature over `px2|org|project|kind|id|version|updated_at|sha256(canonicalJSON(data))`.
//
// WHAT IT DOES NOT MODEL: the 600 ops/hour and 5 create_project/day caps, `uncertain` outcomes and IN_PROGRESS, CORS, peers, jobs,
// attest, the release registry routes, the organisation kinds' routes.
//
// KNOBS FOR FAILURE TESTS: loseNextResponses(n) (the server APPLIES the push and the answer never arrives), failNext({status}) (refused
// before anything is applied), requireUpdate({...}) (forces 426 whatever the release rule says: a floor above this client),
// setRelease({current, minCompatible}) (the registry: the real rule decides), signedOut (401), notLinked (403 NOT_LINKED),
// silent deletes (a delete that leaves no tombstone: what the reconcile exists for), `now` (the rate cap's clock).

import { createSyncClient, type SyncClient } from "../sync-client";

export const FAKE_BASE_URL = "https://fake.sync.test/projexa-sync";

/** The release format both sides use (CONTRACT.md section 0; handler.ts RELEASE_RE): YYYY.MM.DD-NNN. */
export const RELEASE_RE = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$/;
/** The release this fake's own client says it runs. */
export const FAKE_RELEASE = "2026.10.02-003";

/** The real service's limits (handler.ts constants); conformance/wire.integration.test.ts asserts they still equal the handler's. */
export const REAL_LIMITS = {
  BODY_MAX_BYTES: 4096,
  PUSH_BODY_MAX_BYTES: 262_144,
  PUSH_OPS_MAX: 50,
  PULL_IDS_MAX: 200,
  PULL_LIMIT_DEFAULT: 200,
  PULL_LIMIT_MAX: 500,
  CHANGES_LIMIT_MAX: 1000,
  IDS_LIMIT_MAX: 5000,
  REQUESTS_PER_MINUTE: 120,
  SERVER_PROTOCOL: 2,
  OP_MAX_CHARS: 65_536,
} as const;
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const OP_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const FN_RE = /^[A-Za-z0-9_-]{1,128}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

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

/** The real service's opaque cursor: base64url of JSON [ts, id] (handler.ts encodeCursor / decodeCursor). */
function encodeCursor(ts: string, id: string): string {
  return btoa(JSON.stringify([ts, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeCursor(cursor: string): { ts: string; id: string } | null {
  if (cursor.length === 0 || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const v = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" && ID_RE.test(v[1]) ? { ts: v[0], id: v[1] } : null;
  } catch {
    return null;
  }
}

/** X-Px-Client: "<release>; protocol=<n>; schema=<n>" (handler.ts parseClientHeader). */
function parseClientHeader(h: string | undefined): { release: string | null; protocol: number | null } | null {
  if (!h) return null;
  const parts = h.split(";").map((s) => s.trim());
  const out = { release: parts[0] || null, protocol: null as number | null };
  for (const p of parts.slice(1)) {
    const m = /^protocol=(\d{1,4})$/.exec(p);
    if (m) out.protocol = Number(m[1]);
  }
  return out;
}

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────

/** cursor_field: "updated_at" (the default) or null for a table that has none (the real service then pages by created_at). */
export type FakeKind = { kind: string; project_scoped?: boolean; cursor_field?: "updated_at" | null };

type Row = { kind: string; id: string; projectId: string; data: Record<string, unknown>; version: number; updatedAt: string; createdAt: string; deleted: boolean };
type Change = { seq: number; projectId: string; kind: string; id: string; version: number; op: "I" | "U" | "D" };
type LedgerEntry = { hash: string; status: "applied" | "rejected" | "failed" | "needs_server"; record_id?: string; route?: string; version?: number; error_code?: string };

// `body` is whatever JSON the client sent (always an object for the POST routes); tests read its fields directly.
export type FakeRequest = { path: string; method: string; headers: Record<string, string>; body: any; status?: number };

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
  /** The person's SIGN-IN id: the token's subject, what the laptop names its database by. */
  userId?: string;
  /** The person's VERIDIAN id (compliance.users.id, a cuid): the manifest's user.id. Always differs from userId, like the real one. */
  veridianUserId?: string;
  orgId?: string;
  role?: string;
  projects?: string[];
  kinds?: FakeKind[];
  /** Fields nulled in every row's data, with `redacted: true` on the row and the page (a role that may not see cost). */
  hiddenFields?: string[];
  /** The release registry: newest release and the floor (both YYYY.MM.DD-NNN). Absent = an empty registry (nothing gated by release). */
  release?: { current?: string; minCompatible?: string };
  /** Tombstones go in the change log (the default). false = the contract's "deletes made before change tracking existed". */
  trackDeletes?: boolean;
  /** applied answers carry the resulting signed `server` row, as the real service's always do (false = an older, narrower service). */
  includeServerOnApplied?: boolean;
  /** Functions this person's role may not run (rejected ROLE_TOO_LOW). */
  deniedFunctions?: string[];
  /** Requests a minute per person (the real 120). */
  requestsPerMinute?: number;
  /** The rate cap's clock (ms). Defaults to Date.now. */
  now?: () => number;
  /**
   * true = behave EXACTLY like the real handler in the three places where this fake still keeps a legacy default:
   *   (1) id formats: device_id 8..64 chars (else 400) and op_id 8..128 chars (else rejected BAD_OP);
   *   (2) an applied answer always carries the signed `server` row (unless includeServerOnApplied is set false explicitly);
   *   (3) a function with no registered write is rejected FUNCTION_NOT_ALLOWED (legacy: FUNCTION_NOT_AVAILABLE).
   * The default is false ONLY because outbox.test.ts (package FB's file, not editable by package FA) asserts the legacy behaviour: device
   * ids "dev-1"/"d", op ids "x"/"op-flaky"; "an update whose answer carries no row" without asking for it; the FUNCTION_NOT_AVAILABLE
   * sentence for an unknown function. conformance/parity.test.ts and every new test pass `strict: true`. TODO(FB): move those tests to
   * real ids / explicit includeServerOnApplied:false / FUNCTION_NOT_ALLOWED, then make strict the default and delete this option.
   */
  strict?: boolean;
  keyId?: string;
};

export type FakeSyncServer = {
  readonly orgId: string;
  /** The sign-in id (token subject). */
  readonly userId: string;
  /** The VERIDIAN person id (manifest user.id). */
  readonly veridianUserId: string;
  /** The REAL client, talking to this fake over its fetch. */
  client: SyncClient;
  /** Another real client on this fake (e.g. another release, retries on). */
  clientWith(overrides: Partial<Parameters<typeof createSyncClient>[0]>): SyncClient;
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
  setRelease(release: { current?: string; minCompatible?: string } | null): void;
  signedOut: boolean;
  notLinked: boolean;
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
  const veridianUserId = opts.veridianUserId ?? "ckfakeveridianuser000001";
  if (veridianUserId === userId) throw new Error("fake-sync-server: the VERIDIAN id must differ from the sign-in id, as it does for real");
  const kinds: FakeKind[] = opts.kinds ?? [
    { kind: "tasks" }, { kind: "boq_lines" }, { kind: "rfis" }, { kind: "progress", cursor_field: null },
  ];
  const kindSet = new Set(kinds.map((k) => k.kind));
  const kindOf = (kind: string) => kinds.find((k) => k.kind === kind);
  const trackDeletes = opts.trackDeletes !== false;
  const keyId = opts.keyId ?? "fake-key-1";
  const includeServer = opts.includeServerOnApplied ?? opts.strict === true;
  const denied = new Set(opts.deniedFunctions ?? []);
  const perMinute = opts.requestsPerMinute ?? REAL_LIMITS.REQUESTS_PER_MINUTE;
  const nowMs = opts.now ?? (() => Date.now());
  const strict = opts.strict === true;
  const opIdOk = (id: string) => (strict ? OP_ID_RE.test(id) : id.length >= 1 && id.length <= 128);
  const deviceOk = (id: unknown) => typeof id === "string" && (strict ? DEVICE_RE.test(id) : id.length >= 1 && id.length <= 64);

  const rows = new Map<string, Row>();
  const log: Change[] = [];
  const ledger = new Map<string, LedgerEntry>();
  // The public mirror of the ledger (what tests read). Forgetting an op there ("the ledger forgot", a test of a lost ledger row) must forget it for the
  // server too, or a re-send would still be answered `duplicate`: clear() and delete() reach both.
  const publicLedger = new (class extends Map<string, { status: "applied"; record_id?: string; route?: string; version?: number }> {
    override clear(): void { super.clear(); ledger.clear(); }
    override delete(key: string): boolean { ledger.delete(key); return super.delete(key); }
  })();
  let seq = 0;
  let clock = START;
  let idCounter = 0;
  let loseResponses = 0;
  let failure: { status: number; times: number; path?: string } | null = null;
  let forcedUpdate: { current?: string; minCompatible?: string } | null = null;
  let release: { current?: string; minCompatible?: string } | null = opts.release ?? null;
  const handlers = new Map<string, FunctionHandler>();
  const pushed: string[] = [];
  const hits: number[] = [];

  const tick = () => new Date((clock += 1000)).toISOString();
  const rowKey = (kind: string, id: string) => `${kind}:${id}`;
  const serverTime = () => new Date(clock).toISOString();

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

  // The real second money pass (redactItem): a hidden column is nulled (when present) and the row says it was redacted.
  const hidden = new Set(opts.hiddenFields ?? []);
  const visible = (data: Record<string, unknown>) => {
    if (!hidden.size) return data;
    const out: Record<string, unknown> = { ...data };
    for (const c of hidden) if (c in out) out[c] = null;
    out.redacted = true;
    return out;
  };

  async function wireRow(row: Row) {
    const data = visible(row.data);
    // The signature covers exactly the data the client receives (a role's redaction is part of what is signed).
    return { id: row.id, updated_at: row.updatedAt, version: row.version, data, sig: await sign({ ...row, data }) };
  }
  async function serverRow(row: Row) {
    const w = await wireRow(row);
    return { kind: row.kind, id: row.id, version: row.version, updated_at: row.updatedAt, data: w.data, sig: w.sig, kid: keyId };
  }

  const server: FakeSyncServer = {
    orgId, userId, veridianUserId,
    projects: opts.projects ? [...opts.projects] : ["p1"],
    requests: [],
    ledger: publicLedger,
    signedOut: false,
    notLinked: false,
    client: undefined as unknown as SyncClient,
    clientWith: undefined as unknown as FakeSyncServer["clientWith"],
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
      const at = updatedAt ?? (live && touch === false ? live.updatedAt : tick());
      const row: Row = {
        kind, id, projectId, data: { id, ...data },
        version: (existing?.version ?? 0) + 1,
        updatedAt: at,
        createdAt: live?.createdAt ?? at,
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
    requireUpdate(details) { forcedUpdate = details; },
    setRelease(r) { release = r; },
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

  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
  const NOT_FOUND = () => json({ error: "Not found" }, 404);
  const bad = (error: string) => json({ error }, 400);
  const readable = (projectId: unknown) => typeof projectId === "string" && server.projects.includes(projectId);
  const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

  /** The keyset of a kind: (updated_at, id), or (created_at, id) for a table without updated_at -- as the real service pages them. */
  const keyTs = (r: Row) => (kindOf(r.kind)?.cursor_field === null ? r.createdAt : r.updatedAt);
  function sorted(projectId: string, kind: string): Row[] {
    return [...rows.values()]
      .filter((r) => r.projectId === projectId && r.kind === kind && !r.deleted)
      .sort((a, b) => keyTs(a).localeCompare(keyTs(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async function pageOf(items: Row[], next: Row | null, hasMore: boolean) {
    const out: Awaited<ReturnType<typeof wireRow>>[] = [];
    for (const r of items) out.push(await wireRow(r));
    return {
      items: out, kid: keyId,
      next_cursor: next ? encodeCursor(keyTs(next), next.id) : null,
      has_more: hasMore, hidden_fields: [...hidden], redacted: hidden.size > 0, server_time: serverTime(),
    };
  }

  async function handlePull(body: Record<string, unknown>): Promise<Response> {
    const { project_id: projectId, kind } = body;
    if (typeof projectId !== "string" || projectId === "" || projectId.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return bad("project_id and kind are required");
    if (body.ids !== undefined) {
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > REAL_LIMITS.PULL_IDS_MAX || !ids.every((x) => typeof x === "string" && ID_RE.test(x))) return bad(`ids must be 1 to ${REAL_LIMITS.PULL_IDS_MAX} valid ids`);
      if (!kindSet.has(kind) || !readable(projectId)) return NOT_FOUND();
      const found: Row[] = [];
      for (const id of ids as string[]) {
        const r = rows.get(rowKey(kind, id));
        if (r && !r.deleted && r.projectId === projectId) found.push(r);
      }
      return json({ ...(await pageOf(found, null, false)), next_cursor: null });
    }
    const limit = body.limit ?? REAL_LIMITS.PULL_LIMIT_DEFAULT;
    if (!isInt(limit, 1, REAL_LIMITS.PULL_LIMIT_MAX)) return bad(`limit must be a whole number from 1 to ${REAL_LIMITS.PULL_LIMIT_MAX}`);
    const afterRaw = body.after ?? null;
    let after: { ts: string; id: string } | null = null;
    if (afterRaw !== null) {
      if (typeof afterRaw !== "string") return bad("Bad cursor");
      after = decodeCursor(afterRaw);
      if (!after) return bad("Bad cursor");
    }
    if (!kindSet.has(kind) || !readable(projectId)) return NOT_FOUND();
    const list = sorted(projectId, kind).filter((r) => after === null || keyTs(r) > after.ts || (keyTs(r) === after.ts && r.id > after.id));
    const page = list.slice(0, limit as number);
    return json(await pageOf(page, page.length ? page[page.length - 1]! : null, list.length > page.length));
  }

  function handleChanges(body: Record<string, unknown>): Response {
    const project = body.project_id;
    const after = body.after_seq ?? null;
    const limit = body.limit ?? REAL_LIMITS.CHANGES_LIMIT_MAX;
    if (typeof project !== "string" || project === "" || project.length > 128) return bad("project_id is required");
    if (!isInt(limit, 1, REAL_LIMITS.CHANGES_LIMIT_MAX)) return bad(`limit must be a whole number from 1 to ${REAL_LIMITS.CHANGES_LIMIT_MAX}`);
    if (after !== null && (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)) return bad("Bad cursor");
    if (!readable(project)) return NOT_FOUND();
    const mineAll = log.filter((c) => c.projectId === project);
    const head = mineAll.length ? mineAll[mineAll.length - 1]!.seq : 0; // the head of THIS project's feed
    if (after === null) return json({ changes: [], next_seq: head, has_more: false, head_seq: head, server_time: serverTime() });
    const mine = mineAll.filter((c) => c.seq > (after as number) && kindSet.has(c.kind));
    const page = mine.slice(0, limit as number);
    return json({
      changes: page.map((c) => ({ seq: c.seq, kind: c.kind, id: c.id, version: c.version, op: c.op })),
      next_seq: page.length ? page[page.length - 1]!.seq : after,
      has_more: mine.length > page.length,
      head_seq: head,
      server_time: serverTime(),
    });
  }

  function handleIds(body: Record<string, unknown>): Response {
    const { project_id: project, kind } = body;
    const after = body.after_id ?? null;
    const limit = body.limit ?? REAL_LIMITS.IDS_LIMIT_MAX;
    if (typeof project !== "string" || project === "" || project.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return bad("project_id and kind are required");
    if (!isInt(limit, 1, REAL_LIMITS.IDS_LIMIT_MAX)) return bad(`limit must be a whole number from 1 to ${REAL_LIMITS.IDS_LIMIT_MAX}`);
    if (after !== null && (typeof after !== "string" || !ID_RE.test(after))) return bad("Bad cursor");
    if (!kindSet.has(kind) || !readable(project)) return NOT_FOUND();
    const ids = [...rows.values()]
      .filter((r) => r.projectId === project && r.kind === kind && !r.deleted)
      .map((r) => r.id).sort().filter((id) => after === null || id > (after as string));
    const page = ids.slice(0, limit as number);
    return json({ ids: page, has_more: ids.length > page.length, next_id: page.length ? page[page.length - 1] : null, server_time: serverTime() });
  }

  type PushResult = Record<string, unknown>;

  /** drizzle/0681 projexa_sync_push_begin: run | duplicate | conflict | reject | retry, for one op. */
  function begin(op: Record<string, unknown>, opId: string): { action: "reject"; code: string } | { action: "duplicate"; entry: LedgerEntry } | { action: "conflict"; kind: string; id: string; cur: number; base: number } | { action: "run"; hash: string; rec: { kind: string; id: string; base: number } | null } {
    const fn = op.function_id;
    const params = op.params;
    const project = op.project_id;
    // 1. shape
    if (!opIdOk(opId) || typeof fn !== "string" || !FN_RE.test(fn) || params === null || typeof params !== "object" || Array.isArray(params)
      || JSON.stringify(op).length > REAL_LIMITS.OP_MAX_CHARS
      || (fn !== "create_project" && (typeof project !== "string" || project === "" || project.length > 128))
      || (fn === "create_project" && project !== undefined && project !== null)) {
      return { action: "reject", code: "BAD_OP" };
    }
    let rec: { kind: string; id: string; base: number } | null = null;
    if (op.record !== undefined && op.record !== null) {
      const r = op.record as Record<string, unknown>;
      const base = String(r?.base_version ?? "");
      if (typeof r !== "object" || Array.isArray(r) || typeof r.kind !== "string" || typeof r.id !== "string" || !ID_RE.test(r.id) || !kindSet.has(r.kind) || !/^[0-9]{1,15}$/.test(base)) {
        return { action: "reject", code: "BAD_OP" };
      }
      rec = { kind: r.kind, id: r.id, base: Number(base) };
    }
    // 2. a registered write, and a role that may run it now
    if (!handlers.has(fn)) return { action: "reject", code: strict ? "FUNCTION_NOT_ALLOWED" : "FUNCTION_NOT_AVAILABLE" };
    if (denied.has(fn)) return { action: "reject", code: "ROLE_TOO_LOW" };
    // 3. the project binds for this person now
    if (fn !== "create_project" && !readable(project)) return { action: "reject", code: "PROJECT_NOT_READABLE" };
    // 4. the ledger: the same op never has two effects
    const hash = `${fn}|${project ?? ""}|${canonicalJson(params)}|${rec?.kind ?? ""}|${rec?.id ?? ""}`;
    const old = ledger.get(opId);
    if (old) {
      if (old.hash !== hash) return { action: "reject", code: "OP_ID_REUSED" };
      if (old.status === "applied" || old.status === "rejected") return { action: "duplicate", entry: old };
      // failed / needs_server: nothing was written, it may run again
    }
    // 6. the record moved since the laptop edited it (a delete moves it too): CONFLICT, nothing written
    if (rec) {
      const cur = rows.get(rowKey(rec.kind, rec.id))?.version ?? 0;
      if (cur > rec.base) return { action: "conflict", kind: rec.kind, id: rec.id, cur, base: rec.base };
    }
    return { action: "run", hash, rec };
  }

  async function handlePush(body: Record<string, unknown>): Promise<Response> {
    const device = body.device_id;
    const ops = body.ops;
    if (!deviceOk(device)) return bad("device_id is required");
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > REAL_LIMITS.PUSH_OPS_MAX) return bad(`ops must be 1 to ${REAL_LIMITS.PUSH_OPS_MAX} operations`);
    const results: PushResult[] = [];
    const held = new Set<string>(); // a record whose earlier op in this batch did not apply keeps its later ops waiting
    for (const raw of ops as unknown[]) {
      const op = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      const opId = op && typeof op.op_id === "string" ? op.op_id : null;
      if (!op || !opId) { results.push({ op_id: opId, status: "rejected", error: { code: "BAD_OP" } }); continue; }
      pushed.push(opId);
      const r = op.record as Record<string, unknown> | null | undefined;
      const recKey = r && typeof r === "object" && typeof r.kind === "string" && typeof r.id === "string" ? rowKey(r.kind, r.id) : null;
      const hold = () => { if (recKey) held.add(recKey); };
      if (recKey && held.has(recKey)) { results.push({ op_id: opId, status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } }); continue; }

      const decision = begin(op, opId);
      if (decision.action === "reject") { results.push({ op_id: opId, status: "rejected", error: { code: decision.code } }); continue; }
      if (decision.action === "duplicate") {
        const e = decision.entry;
        results.push(e.status === "applied"
          ? { op_id: opId, status: "duplicate", record_id: e.record_id ?? null, route: e.route ?? null, version: e.version ?? null }
          : { op_id: opId, status: "rejected", error: { code: e.error_code ?? "REJECTED" } });
        continue;
      }
      const projectId = String(op.project_id);
      if (decision.action === "conflict") {
        hold();
        const row = rows.get(rowKey(decision.kind, decision.id));
        const serverSide = row && !row.deleted && row.projectId === projectId ? await serverRow(row) : null;
        results.push({ op_id: opId, status: "conflict", version: decision.cur, base_version: decision.base, server: serverSide });
        continue;
      }

      const target = decision.rec ? rows.get(rowKey(decision.rec.kind, decision.rec.id)) : undefined;
      const live = target && !target.deleted && target.projectId === projectId ? target : null;
      const outcome = handlers.get(String(op.function_id))!({ server, functionId: String(op.function_id), projectId, params: op.params as Record<string, unknown>, target: live });
      if ("rejected" in outcome) {
        ledger.set(opId, { hash: decision.hash, status: "rejected", error_code: outcome.rejected });
        results.push({ op_id: opId, status: "rejected", error: { code: outcome.rejected, missing: outcome.missing ?? [] } });
        continue;
      }
      // `failed` is the WIRE status (nothing written, kept and retried). Which pipeline codes the real handler turns into `failed` rather
      // than `rejected` is its own (handler.ts TRANSIENT_CODES, being widened by the backend packages): a test that wants a refusal
      // says `rejected`.
      if ("failed" in outcome) {
        hold();
        ledger.set(opId, { hash: decision.hash, status: "failed", error_code: outcome.failed });
        results.push({ op_id: opId, status: "failed", error: { code: outcome.failed, missing: [] } });
        continue;
      }
      if ("needsServer" in outcome) {
        hold();
        ledger.set(opId, { hash: decision.hash, status: "needs_server", error_code: "FUNCTION_NOT_AVAILABLE" });
        results.push({ op_id: opId, status: "needs_server", error: { code: "FUNCTION_NOT_AVAILABLE", missing: [] } });
        continue;
      }

      const existing = rows.get(rowKey(outcome.kind, outcome.id));
      const at = tick();
      const row: Row = {
        kind: outcome.kind, id: outcome.id, projectId, data: outcome.data,
        version: (existing?.version ?? 0) + 1, updatedAt: at, createdAt: existing && !existing.deleted ? existing.createdAt : at, deleted: false,
      };
      rows.set(rowKey(row.kind, row.id), row);
      record(row, existing && !existing.deleted ? "U" : "I");
      const stored = { status: "applied" as const, record_id: row.id, route: outcome.route, version: row.version };
      ledger.set(opId, { hash: decision.hash, ...stored });
      publicLedger.set(opId, stored);
      results.push({ op_id: opId, status: "applied", record_id: row.id, route: outcome.route ?? null, version: row.version, ...(includeServer ? { server: await serverRow(row) } : {}) });
    }
    return json({ results, server_time: serverTime() });
  }

  const ROUTES: Record<string, "GET" | "POST"> = { "/manifest": "GET", "/pull": "POST", "/changes": "POST", "/ids": "POST", "/push": "POST" };

  /** 426 when the laptop speaks another protocol or its release (YYYY.MM.DD-NNN) is below the floor; anything else is never blocked. */
  function updateRequired(headers: Record<string, string>): Response | null {
    if (forcedUpdate) {
      return json({ error: "Update required", code: "UPDATE_REQUIRED", current: forcedUpdate.current ?? null, min_compatible: forcedUpdate.minCompatible ?? null, protocol: REAL_LIMITS.SERVER_PROTOCOL, reason: "release" }, 426);
    }
    const client = parseClientHeader(headers["x-px-client"]);
    if (!client) return null;
    const protocolBad = client.protocol !== null && client.protocol !== REAL_LIMITS.SERVER_PROTOCOL;
    const floor = release?.minCompatible ?? "";
    const releaseBad = floor !== "" && client.release !== null && RELEASE_RE.test(client.release) && client.release < floor;
    if (!protocolBad && !releaseBad) return null;
    return json({ error: "Update required", code: "UPDATE_REQUIRED", current: release?.current ?? null, min_compatible: floor || null, protocol: REAL_LIMITS.SERVER_PROTOCOL, reason: protocolBad ? "protocol" : "release" }, 426);
  }

  async function answer(path: string, method: string, headers: Record<string, string>, raw: string | undefined): Promise<Response> {
    if (method === "OPTIONS") return json(null, 204);
    if (!(path in ROUTES)) return NOT_FOUND();
    if (method !== ROUTES[path]) return json({ error: "Method not allowed" }, 405, { Allow: `${ROUTES[path]}, OPTIONS` });
    if (server.signedOut || !/^Bearer\s+\S+$/i.test(headers.authorization ?? "")) return json({ error: "Sign in again" }, 401);
    const t = nowMs();
    while (hits.length && t - hits[0]! >= 60_000) hits.shift();
    if (hits.length >= perMinute) return json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" });
    hits.push(t);
    const blocked = updateRequired(headers);
    if (blocked) return blocked;
    if (server.notLinked) return json({ error: "This sign-in is not linked to a PROJEXA person.", code: "NOT_LINKED" }, 403);
    if (failure && (!failure.path || failure.path === path) && failure.times > 0) {
      failure.times -= 1;
      return json({ error: "refused" }, failure.status);
    }
    if (path === "/manifest") {
      return json({
        user: { id: veridianUserId, name: "Test User", role: opts.role ?? "member", org_id: orgId, auth_user_id: userId },
        projects: server.projects.map((id) => ({ id, name: `Project ${id}`, status: "active" })),
        kinds: kinds.map((k) => ({ kind: k.kind, project_scoped: k.project_scoped !== false, cursor_field: k.cursor_field === null ? "created_at" : "updated_at", deletes_supported: trackDeletes })),
        view_class: "0123456789abcdef",
        org_kinds: [],
        org_view_class: null,
        release: { current: release?.current ?? null, min_compatible: release?.minCompatible || null, protocol: REAL_LIMITS.SERVER_PROTOCOL },
        server_time: serverTime(),
      });
    }
    // Every body but a push is capped at 4 KB, a push at 256 KB (handler.ts readBody).
    const text = raw ?? "";
    if (text.length > (path === "/push" ? REAL_LIMITS.PUSH_BODY_MAX_BYTES : REAL_LIMITS.BODY_MAX_BYTES)) return json({ error: "Body too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");
    const b = body as Record<string, unknown>;
    if (path === "/pull") return handlePull(b);
    if (path === "/changes") return handleChanges(b);
    if (path === "/ids") return handleIds(b);
    return handlePush(b);
  }

  server.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(FAKE_BASE_URL.length);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const raw = typeof init?.body === "string" ? init.body : undefined;
    let parsed: unknown;
    try {
      parsed = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const req: FakeRequest = { path, method: init?.method ?? "GET", headers, body: parsed };
    server.requests.push(req);
    const response = await answer(path, req.method, headers, raw);
    req.status = response.status;
    // The request WAS processed; the answer never arrives (a dropped connection after the server did its work).
    if (loseResponses > 0 && path === "/push") {
      loseResponses -= 1;
      throw new TypeError("network lost after the server applied the request");
    }
    return response;
  }) as typeof fetch;

  server.clientWith = (overrides) =>
    createSyncClient({
      getAccessToken: async () => `fake-token-for-${userId}`,
      baseUrl: FAKE_BASE_URL,
      fetchImpl: server.fetchImpl,
      sleep: async () => {},
      maxRetries: 0, // a lost response must surface to the OUTBOX (which owns the back-off), not be silently re-sent by the client
      getReleaseVersion: () => FAKE_RELEASE,
      ...overrides,
    });
  server.client = server.clientWith({});
  return server;
}
