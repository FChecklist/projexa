// LOCAL-FIRST slice 2: the typed fetch client for the PROJEXA sync service (a Supabase Edge Function,
// never a Vercel function). The contract:
//   GET  <base>/manifest -> { user:{id,name,role,org_id}, projects:[{id,name,status}],
//                             kinds:[{kind,project_scoped,cursor_field?,deletes_supported?}], server_time }
//   POST <base>/pull {project_id, kind, after: cursor|null, limit<=500}
//        -> { items:[{id,updated_at,data,deleted?}], next_cursor|null, has_more, hidden_fields[], redacted, server_time }
//        404 for an unknown or unreadable project or kind.
// Auth: `Authorization: Bearer <PROJEXA Supabase access token>`; no cookie is sent (credentials omitted).
//
// This client throws a typed SyncError and nothing else; the sync engine (replica.ts) catches it and turns it
// into a status, so an error here never reaches a screen as an exception.

export const SYNC_BASE_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";

/** The service's own page maximum. */
export const SYNC_PAGE_LIMIT = 500;

export type SyncManifest = {
  user: { id: string; name?: string; role?: string; org_id: string };
  projects: { id: string; name?: string; status?: string }[];
  kinds: { kind: string; project_scoped?: boolean; cursor_field?: string; deletes_supported?: boolean }[];
  server_time?: string;
};

export type SyncItem = { id: string; updated_at: string; data: unknown; deleted?: boolean };

/** Opaque to the client: whatever the service handed back is passed back unchanged. */
export type SyncCursor = string | number;

export type SyncPage = {
  items: SyncItem[];
  next_cursor: SyncCursor | null;
  has_more: boolean;
  hidden_fields: string[];
  redacted: boolean;
  server_time?: string;
};

export type SyncErrorKind =
  | "signed_out" // 401, or no access token at all: stop everything and tell the person to sign in again
  | "not_found" // 404: the project or kind is unknown or no longer readable by this person
  | "rate_limited" // 429 that outlasted the retries
  | "server" // 5xx that outlasted the retries
  | "network" // the request never got an answer
  | "timeout"
  | "aborted"
  | "bad_response"; // the service answered with something that is not the contract

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly status: number;
  constructor(kind: SyncErrorKind, message: string, status = 0) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    this.status = status;
  }
}

export type SyncClientOptions = {
  getAccessToken: () => Promise<string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseManifest(body: unknown): SyncManifest {
  if (!isObject(body) || !isObject(body.user) || typeof body.user.id !== "string" || typeof body.user.org_id !== "string"
    || !Array.isArray(body.projects) || !Array.isArray(body.kinds)) {
    throw new SyncError("bad_response", "The sync service sent a manifest this version does not understand.");
  }
  const projects = body.projects.filter((p): p is { id: string } => isObject(p) && typeof p.id === "string") as SyncManifest["projects"];
  const kinds = body.kinds.filter((k): k is { kind: string } => isObject(k) && typeof k.kind === "string") as SyncManifest["kinds"];
  return { user: body.user as SyncManifest["user"], projects, kinds, server_time: typeof body.server_time === "string" ? body.server_time : undefined };
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
    items.push({ id: raw.id, updated_at: raw.updated_at, data: raw.data, deleted: raw.deleted === true });
  }
  return {
    items,
    next_cursor: cursor ?? null,
    has_more: body.has_more,
    hidden_fields: Array.isArray(body.hidden_fields) ? body.hidden_fields.filter((f): f is string => typeof f === "string") : [],
    redacted: body.redacted === true,
    server_time: typeof body.server_time === "string" ? body.server_time : undefined,
  };
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const base = (options.baseUrl ?? SYNC_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxRetries = options.maxRetries ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown }, outer?: AbortSignal): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      if (outer?.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const token = await options.getAccessToken();
      if (!token) throw new SyncError("signed_out", "You are signed out. Sign in again to copy your projects to this laptop.", 401);

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
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
        if (err instanceof SyncError && (err.kind === "signed_out" || err.kind === "not_found" || err.kind === "bad_response")) throw err;
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
  };
}
