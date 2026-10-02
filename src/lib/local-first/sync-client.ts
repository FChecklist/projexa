// LOCAL-FIRST slice 2: the typed fetch client for the PROJEXA sync service (a Supabase Edge Function,
// never a Vercel function). The contract is docs/local-first/CONTRACT.md; in short:
//   GET  <base>/manifest -> { user:{id,name,role,org_id}, projects:[{id,name,status}],
//                             kinds:[{kind,project_scoped,cursor_field?,deletes_supported?}], release?, view_class?, server_time }
//   POST <base>/pull     {project_id, kind, after: cursor|null, limit<=500}   (keyset)
//                    or  {project_id, kind, ids:[<=200]}                      (exact rows; this client sends <=80 ids and <=3,500 chars)
//        -> { items:[{id,updated_at,version?,data,sig?,deleted?}], kid?, next_cursor|null, has_more, hidden_fields[], redacted, server_time }
//        404 for an unknown or unreadable project or kind.
//   POST <base>/changes  {project_id, after_seq: int|null, limit<=1000}
//        -> { changes:[{seq,kind,id,version,op:"I"|"U"|"D"}], next_seq, has_more, head_seq, server_time }
//   POST <base>/ids      {project_id, kind, after_id, limit<=5000} -> { ids, has_more, next_id }
//   POST <base>/push     {device_id, ops:[{op_id,function_id,project_id,params,record?,resolution?,client_at}]}
//        -> { results:[{op_id,status,record_id?,route?,version?,server?,error?}], server_time }
// Auth: `Authorization: Bearer <PROJEXA Supabase access token>`; no cookie is sent (credentials omitted).
// Every call also sends `X-Px-Client: <release>; protocol=2; schema=3`. A laptop whose release is below the
// service's minimum gets 426, which this client turns into the SyncError kind "update_required" (never retried).
//
// An OLDER service answers without versions, signatures or the new endpoints: every new field is optional here
// and every parser tolerates its absence.
//
// This client throws a typed SyncError and nothing else; the sync engine (replica.ts) and the outbox
// (outbox.ts) catch it and turn it into a status, so an error here never reaches a screen as an exception.

import { LOCAL_DB_VERSION } from "./local-db";

export const SYNC_BASE_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";

/** The service's own page maximum. */
export const SYNC_PAGE_LIMIT = 500;
/**
 * The most ids one `pull {ids}` call may name (larger lists are split by this client). The service ACCEPTS up to 200 ids, but it refuses
 * any non-push body over 4,096 characters with 413 (handler.ts BODY_MAX_BYTES): 200 uuid ids are ~7.8 KB. So a request is cut at 80 ids
 * AND at SYNC_IDS_BODY_MAX_BYTES of JSON, whichever comes first (review SYNC-06 / F03: a 200-id chunk was a 413 that wedged a project's
 * change feed for good).
 */
export const SYNC_IDS_LIMIT = 80;
/** The largest `pull {ids}` body this client sends, in characters of JSON: well under the deployed service's 4,096 cap. */
export const SYNC_IDS_BODY_MAX_BYTES = 3500;
export const SYNC_CHANGES_LIMIT = 1000;
export const SYNC_ID_LIST_LIMIT = 5000;
/** The sync protocol this client speaks (CONTRACT.md section 0), sent with every call. */
export const SYNC_PROTOCOL = 2;

export type SyncManifest = {
  /**
   * `id` is the VERIDIAN person (compliance.users.id, a cuid); `auth_user_id` is the verified token subject, the SIGN-IN id the laptop
   * knows the person by (supabase.auth.getUser().id). They are different strings: compare a laptop's person with manifestSignInId().
   */
  user: { id: string; auth_user_id?: string; name?: string; role?: string; org_id: string };
  projects: { id: string; name?: string; status?: string }[];
  kinds: { kind: string; project_scoped?: boolean; cursor_field?: string; deletes_supported?: boolean }[];
  view_class?: string;
  release?: { current?: string; min_compatible?: string; protocol?: number };
  server_time?: string;
};

export type SyncItem = {
  id: string;
  updated_at: string;
  data: unknown;
  deleted?: boolean;
  /** The record version the backend holds (CONTRACT.md section 0). Absent from an older service. */
  version?: number;
  /** ES256 signature over px2|org|project|kind|id|version|updated_at|sha256(canonical data). Absent = unsigned. */
  sig?: string;
};

/** Opaque to the client: whatever the service handed back is passed back unchanged. */
export type SyncCursor = string | number;

export type SyncPage = {
  items: SyncItem[];
  /** The key id that signed this page's items; null/absent = unsigned (never pass such rows to a peer). */
  kid?: string | null;
  next_cursor: SyncCursor | null;
  has_more: boolean;
  hidden_fields: string[];
  redacted: boolean;
  server_time?: string;
};

export type SyncChange = { seq: number; kind: string; id: string; version: number; op: "I" | "U" | "D" };

export type ChangesPage = {
  changes: SyncChange[];
  next_seq: number;
  has_more: boolean;
  head_seq: number;
  server_time?: string;
};

export type IdsPage = { ids: string[]; has_more: boolean; next_id: string | null };

/** One row as the push endpoint returns it (a conflict's current server row, or the row an op produced). */
export type SyncServerRow = {
  kind: string;
  id: string;
  version: number;
  updated_at: string;
  data: unknown;
  sig?: string;
  kid?: string;
};

export type PushOp = {
  op_id: string;
  function_id: string;
  project_id: string;
  params: Record<string, unknown>;
  record?: { kind: string; id: string; base_version: number };
  resolution?: "overwrite";
  client_at: string;
};

export type PushStatus = "applied" | "duplicate" | "conflict" | "rejected" | "failed" | "needs_server";

export type PushResult = {
  op_id: string;
  status: PushStatus;
  record_id?: string;
  route?: string;
  /** The record's new head version (applied / duplicate). */
  version?: number;
  /** conflict: the current signed server row. applied/duplicate: the row as it now is, when the service sends it. */
  server?: SyncServerRow;
  error?: { code: string; missing?: string[]; message?: string };
};

export type PushResponse = { results: PushResult[]; server_time?: string };

export type SyncErrorKind =
  | "signed_out" // 401, or no access token at all: stop everything and tell the person to sign in again
  | "not_found" // 404: the project or kind is unknown or no longer readable by this person
  | "update_required" // 426: this release is below the service's minimum; the app must update before it syncs
  | "rate_limited" // 429 that outlasted the retries
  | "server" // 5xx that outlasted the retries
  | "network" // the request never got an answer
  | "timeout"
  | "aborted"
  | "bad_response"; // the service answered with something that is not the contract

export type UpdateRequiredDetails = { current: string | null; minCompatible: string | null };

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly status: number;
  /** Only for kind "update_required": what the service said about the newest and the oldest allowed release. */
  readonly update?: UpdateRequiredDetails;
  constructor(kind: SyncErrorKind, message: string, status = 0, update?: UpdateRequiredDetails) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    this.status = status;
    if (update) this.update = update;
  }
}

export type SyncClientOptions = {
  getAccessToken: () => Promise<string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** The release of the downloaded app, sent as X-Px-Client. Defaults to "dev". */
  getReleaseVersion?: () => string;
  /** One attempt's ceiling. */
  timeoutMs?: number;
  /** Retries after the first attempt, for 429, 5xx, timeouts and network failures. */
  maxRetries?: number;
  /** First retry waits this long, then doubles (a Retry-After header wins when present). */
  backoffMs?: number;
  /** Injected so tests do not really wait. Resolves early when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type SyncClient = {
  manifest(signal?: AbortSignal): Promise<SyncManifest>;
  pull(req: { projectId: string; kind: string; after: SyncCursor | null; limit?: number }, signal?: AbortSignal): Promise<SyncPage>;
  /** Exact rows by id (the way a row of a table without updated_at is refreshed). More than 200 ids are split into several calls. */
  pullIds(req: { projectId: string; kind: string; ids: string[] }, signal?: AbortSignal): Promise<SyncPage>;
  changes(req: { projectId: string; afterSeq: number | null; limit?: number }, signal?: AbortSignal): Promise<ChangesPage>;
  ids(req: { projectId: string; kind: string; afterId: string | null; limit?: number }, signal?: AbortSignal): Promise<IdsPage>;
  push(req: { deviceId: string; ops: PushOp[] }, signal?: AbortSignal): Promise<PushResponse>;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asVersion(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function parseManifest(body: unknown): SyncManifest {
  if (!isObject(body) || !isObject(body.user) || typeof body.user.id !== "string" || typeof body.user.org_id !== "string"
    || !Array.isArray(body.projects) || !Array.isArray(body.kinds)) {
    throw new SyncError("bad_response", "The sync service sent a manifest this version does not understand.");
  }
  const projects = body.projects.filter((p): p is { id: string } => isObject(p) && typeof p.id === "string") as SyncManifest["projects"];
  const kinds = body.kinds.filter((k): k is { kind: string } => isObject(k) && typeof k.kind === "string") as SyncManifest["kinds"];
  const release = isObject(body.release) ? (body.release as SyncManifest["release"]) : undefined;
  return {
    user: body.user as SyncManifest["user"], projects, kinds,
    ...(typeof body.view_class === "string" ? { view_class: body.view_class } : {}),
    ...(release ? { release } : {}),
    server_time: typeof body.server_time === "string" ? body.server_time : undefined,
  };
}

/**
 * Splits an id list into `pull {ids}` requests of at most SYNC_IDS_LIMIT ids and SYNC_IDS_BODY_MAX_BYTES characters of JSON body each
 * (the body measured exactly as it is sent). An id is never split or dropped; a single id too long to fit alone still travels on its own
 * (the service then answers for it). Pure.
 */
export function chunkIds(projectId: string, kind: string, ids: readonly string[]): string[][] {
  const envelope = JSON.stringify({ project_id: projectId, kind, ids: [] }).length;
  const out: string[][] = [];
  let current: string[] = [];
  let size = envelope;
  for (const id of ids) {
    const cost = JSON.stringify(id).length; // the id as sent, quotes and escapes included
    if (current.length && (current.length >= SYNC_IDS_LIMIT || size + 1 + cost > SYNC_IDS_BODY_MAX_BYTES)) {
      out.push(current);
      current = [];
      size = envelope;
    }
    size += cost + (current.length ? 1 : 0); // and its comma
    current.push(id);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The sign-in id a manifest belongs to: `user.auth_user_id` (the token subject the server verified) whenever the server sends it; an
 * older server that answers without it is compared by `user.id`. A laptop stores a manifest only when this equals its own sign-in id.
 * (Review F01: comparing the sign-in id with `user.id` made every real sync end in user_mismatch.) Pure.
 */
export function manifestSignInId(manifest: Pick<SyncManifest, "user">): string {
  const sub = (manifest.user as { auth_user_id?: unknown }).auth_user_id;
  return sub !== undefined && sub !== null ? (typeof sub === "string" ? sub : "") : manifest.user.id;
}

function parsePage(body: unknown): SyncPage {
  if (!isObject(body) || !Array.isArray(body.items) || typeof body.has_more !== "boolean") {
    throw new SyncError("bad_response", "The sync service sent a page this version does not understand.");
  }
  const cursor = body.next_cursor;
  if (cursor !== null && cursor !== undefined && typeof cursor !== "string" && typeof cursor !== "number") {
    throw new SyncError("bad_response", "The sync service sent a cursor this version does not understand.");
  }
  const items: SyncItem[] = [];
  for (const raw of body.items) {
    if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.updated_at !== "string") {
      throw new SyncError("bad_response", "The sync service sent a malformed item.");
    }
    const item: SyncItem = { id: raw.id, updated_at: raw.updated_at, data: raw.data, deleted: raw.deleted === true };
    const version = asVersion(raw.version);
    if (version !== undefined) item.version = version;
    if (typeof raw.sig === "string" && raw.sig.length > 0) item.sig = raw.sig;
    items.push(item);
  }
  return {
    items,
    kid: typeof body.kid === "string" ? body.kid : null,
    next_cursor: cursor ?? null,
    has_more: body.has_more,
    hidden_fields: Array.isArray(body.hidden_fields) ? body.hidden_fields.filter((f): f is string => typeof f === "string") : [],
    redacted: body.redacted === true,
    server_time: typeof body.server_time === "string" ? body.server_time : undefined,
  };
}

function parseChanges(body: unknown, afterSeq: number | null): ChangesPage {
  if (!isObject(body) || !Array.isArray(body.changes)) {
    throw new SyncError("bad_response", "The sync service sent a change list this version does not understand.");
  }
  const head = typeof body.head_seq === "number" && Number.isFinite(body.head_seq) ? body.head_seq : null;
  if (head === null) throw new SyncError("bad_response", "The sync service sent a change list without its head position.");
  const changes: SyncChange[] = [];
  for (const raw of body.changes) {
    if (!isObject(raw) || typeof raw.seq !== "number" || typeof raw.kind !== "string" || typeof raw.id !== "string"
      || (raw.op !== "I" && raw.op !== "U" && raw.op !== "D")) {
      throw new SyncError("bad_response", "The sync service sent a malformed change.");
    }
    changes.push({ seq: raw.seq, kind: raw.kind, id: raw.id, version: asVersion(raw.version) ?? 0, op: raw.op });
  }
  const next = typeof body.next_seq === "number" && Number.isFinite(body.next_seq) ? body.next_seq : (afterSeq ?? head);
  return {
    changes, next_seq: next, has_more: body.has_more === true, head_seq: head,
    server_time: typeof body.server_time === "string" ? body.server_time : undefined,
  };
}

function parseIds(body: unknown): IdsPage {
  if (!isObject(body) || !Array.isArray(body.ids) || typeof body.has_more !== "boolean") {
    throw new SyncError("bad_response", "The sync service sent an id list this version does not understand.");
  }
  const next = body.next_id;
  if (next !== null && next !== undefined && typeof next !== "string") {
    throw new SyncError("bad_response", "The sync service sent an id cursor this version does not understand.");
  }
  return { ids: body.ids.filter((i): i is string => typeof i === "string"), has_more: body.has_more, next_id: next ?? null };
}

function parseServerRow(raw: unknown): SyncServerRow | undefined {
  if (!isObject(raw) || typeof raw.kind !== "string" || typeof raw.id !== "string") return undefined;
  const version = asVersion(raw.version);
  if (version === undefined) return undefined;
  return {
    kind: raw.kind, id: raw.id, version,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
    data: raw.data,
    ...(typeof raw.sig === "string" && raw.sig ? { sig: raw.sig } : {}),
    ...(typeof raw.kid === "string" && raw.kid ? { kid: raw.kid } : {}),
  };
}

const PUSH_STATUSES: readonly PushStatus[] = ["applied", "duplicate", "conflict", "rejected", "failed", "needs_server"];

function parsePush(body: unknown): PushResponse {
  if (!isObject(body) || !Array.isArray(body.results)) {
    throw new SyncError("bad_response", "The sync service sent a push answer this version does not understand.");
  }
  const results: PushResult[] = [];
  for (const raw of body.results) {
    if (!isObject(raw) || typeof raw.op_id !== "string" || typeof raw.status !== "string") {
      throw new SyncError("bad_response", "The sync service sent a malformed push result.");
    }
    const known = (PUSH_STATUSES as readonly string[]).includes(raw.status);
    const result: PushResult = {
      op_id: raw.op_id,
      // A status this version has never heard of is a transient failure: keep the op, ask again later (a newer server, a partial deploy).
      status: known ? (raw.status as PushStatus) : "failed",
    };
    if (typeof raw.record_id === "string") result.record_id = raw.record_id;
    if (typeof raw.route === "string") result.route = raw.route;
    const version = asVersion(raw.version);
    if (version !== undefined) result.version = version;
    const server = parseServerRow(raw.server);
    if (server) result.server = server;
    if (isObject(raw.error) && typeof raw.error.code === "string") {
      result.error = {
        code: raw.error.code,
        ...(Array.isArray(raw.error.missing) ? { missing: raw.error.missing.filter((m): m is string => typeof m === "string") } : {}),
        ...(typeof raw.error.message === "string" ? { message: raw.error.message } : {}),
      };
    } else if (!known) {
      result.error = { code: "UNKNOWN_STATUS" };
    }
    results.push(result);
  }
  return { results, server_time: typeof body.server_time === "string" ? body.server_time : undefined };
}

/** What a 426 body says about releases. Every field is optional: the service may send little or nothing. */
function parseUpdateRequired(body: unknown): UpdateRequiredDetails {
  const o = isObject(body) ? body : {};
  const nested = isObject(o.release) ? o.release : {};
  const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    current: text(o.current) ?? text(nested.current),
    minCompatible: text(o.min_compatible) ?? text(o.minCompatible) ?? text(nested.min_compatible),
  };
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const base = (options.baseUrl ?? SYNC_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxRetries = options.maxRetries ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const release = options.getReleaseVersion ?? (() => "dev");

  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number }, outer?: AbortSignal): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      if (outer?.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const token = await options.getAccessToken();
      if (!token) throw new SyncError("signed_out", "You are signed out. Sign in again to copy your projects to this laptop.", 401);

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, init.timeoutMs ?? timeoutMs);
      const onOuterAbort = () => controller.abort();
      outer?.addEventListener("abort", onOuterAbort, { once: true });

      let retryAfterMs: number | null = null;
      let failure!: SyncError;
      try {
        const res = await doFetch(`${base}${path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "X-Px-Client": `${release()}; protocol=${SYNC_PROTOCOL}; schema=${LOCAL_DB_VERSION}`,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 401) {
          throw new SyncError("signed_out", "Your sign-in is no longer valid. Sign in again to copy your projects to this laptop.", res.status);
        }
        if (res.status === 426) {
          const details = parseUpdateRequired(await res.json().catch(() => null));
          throw new SyncError("update_required", "PROJEXA on this laptop must be updated before it can sync.", res.status, details);
        }
        if (res.status === 404) throw new SyncError("not_found", "That project or data kind is not available to you.", 404);
        if (res.status === 429 || res.status >= 500) {
          const header = Number(res.headers?.get?.("Retry-After"));
          if (Number.isFinite(header) && header > 0) retryAfterMs = Math.min(header * 1000, 30_000);
          failure = new SyncError(res.status === 429 ? "rate_limited" : "server", `The sync service answered ${res.status}.`, res.status);
        } else if (!res.ok) {
          throw new SyncError("bad_response", `The sync service answered ${res.status}.`, res.status);
        } else {
          try {
            return await res.json();
          } catch {
            throw new SyncError("bad_response", "The sync service did not send JSON.", res.status);
          }
        }
      } catch (err) {
        if (err instanceof SyncError && (err.kind === "signed_out" || err.kind === "not_found" || err.kind === "bad_response" || err.kind === "update_required")) throw err;
        if (outer?.aborted) throw new SyncError("aborted", "The sync was cancelled.");
        failure = err instanceof SyncError
          ? err
          : timedOut
            ? new SyncError("timeout", "The sync service did not answer in time.")
            : new SyncError("network", "The sync service could not be reached.");
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
      }

      if (attempt >= maxRetries) throw failure;
      await sleep(retryAfterMs ?? backoffMs * 2 ** attempt, outer);
      attempt += 1;
    }
  }

  return {
    async manifest(signal) {
      return parseManifest(await request("/manifest", { method: "GET" }, signal));
    },
    async pull(req, signal) {
      const limit = Math.min(Math.max(1, req.limit ?? SYNC_PAGE_LIMIT), SYNC_PAGE_LIMIT);
      return parsePage(await request("/pull", { method: "POST", body: { project_id: req.projectId, kind: req.kind, after: req.after, limit } }, signal));
    },
    async pullIds(req, signal) {
      const merged: SyncPage = { items: [], kid: null, next_cursor: null, has_more: false, hidden_fields: [], redacted: false };
      for (const chunk of chunkIds(req.projectId, req.kind, req.ids)) {
        const page = parsePage(await request("/pull", { method: "POST", body: { project_id: req.projectId, kind: req.kind, ids: chunk } }, signal));
        merged.items.push(...page.items);
        merged.kid = page.kid ?? merged.kid;
        merged.redacted = merged.redacted || page.redacted;
        for (const f of page.hidden_fields) if (!merged.hidden_fields.includes(f)) merged.hidden_fields.push(f);
        merged.server_time = page.server_time ?? merged.server_time;
      }
      return merged;
    },
    async changes(req, signal) {
      const limit = Math.min(Math.max(1, req.limit ?? SYNC_CHANGES_LIMIT), SYNC_CHANGES_LIMIT);
      return parseChanges(await request("/changes", { method: "POST", body: { project_id: req.projectId, after_seq: req.afterSeq, limit } }, signal), req.afterSeq);
    },
    async ids(req, signal) {
      const limit = Math.min(Math.max(1, req.limit ?? SYNC_ID_LIST_LIMIT), SYNC_ID_LIST_LIMIT);
      return parseIds(await request("/ids", { method: "POST", body: { project_id: req.projectId, kind: req.kind, after_id: req.afterId, limit } }, signal));
    },
    async push(req, signal) {
      // The service runs every op through the real pipeline, one after another: allow it longer than a read. A timeout
      // is safe -- the same op_id sent again is answered "duplicate", never applied twice.
      return parsePush(await request("/push", { method: "POST", body: { device_id: req.deviceId, ops: req.ops }, timeoutMs: Math.max(timeoutMs, 60_000) }, signal));
    },
  };
}
