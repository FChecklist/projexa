// LOCAL-FIRST release: the laptop's side of the registry calls in docs/local-first/CONTRACT.md section 3, all on the sync
// service (a Supabase Edge Function, never Vercel):
//
//   GET  /release/current   -> { current:{release_version, manifest_sha256, built_at, files:[{path,file_no,file_version,sha256,size}]},
//                                min_compatible, registered }
//   POST /release/register  {}   the SERVER fetches release.json from the allow-listed origin and registers it (no input from here)
//   POST /install           {device_id, release_version, manifest_sha256, previous_release?, downloaded_at, installed_at, files, bytes,
//                            status:"installed"|"updated"|"failed", error?}
//
// EVERY call here is best effort and silent: a laptop that is offline, or whose sync service is down or not deployed yet, must
// keep working, so a failure returns null / false and never throws, and never shows anything. The header X-Px-Client names the
// release this laptop runs, the protocol and the local schema (CONTRACT.md "Every call").

import { SYNC_BASE_URL } from "../sync-client";

export const SYNC_PROTOCOL = 2;

/** The manifest the build writes (scripts/make-release.mjs) and the app serves at /_release/release.json. */
export type ReleaseManifest = {
  release_version: string;
  git_sha: string | null;
  built_at: string;
  protocol: number;
  schema: number;
  bundle: { path: string; size: number; sha256: string };
  files: { path: string; size: number; sha256: string }[];
  manifest_sha256: string;
};

/** One file as the REGISTRY numbers it: file_no is permanent for a path, file_version bumps when the bytes change. */
export type RegistryFile = { path: string; file_no: number; file_version: number; sha256: string; size: number };

export type RegistryRelease = {
  release_version: string;
  manifest_sha256: string;
  built_at: string;
  files: RegistryFile[];
};

export type CurrentRelease = {
  current: RegistryRelease | null;
  min_compatible: string | null;
  /** Whether the release this laptop reported in X-Px-Client is known to the registry. */
  registered: boolean;
};

export type InstallStatus = "installed" | "updated" | "failed";

export type InstallRecord = {
  device_id: string;
  release_version: string;
  manifest_sha256: string;
  previous_release?: string | null;
  downloaded_at: string;
  installed_at: string;
  files: number;
  bytes: number;
  status: InstallStatus;
  error?: string;
};

export type ReleaseClientOptions = {
  getAccessToken: () => Promise<string | null>;
  /** The release version this laptop is running now (for X-Px-Client). */
  clientVersion?: () => string | null;
  /** The local database schema number (for X-Px-Client). */
  schema?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type ReleaseClient = {
  /** GET /release/current, or null when it cannot be had for any reason. */
  current(signal?: AbortSignal): Promise<CurrentRelease | null>;
  /** POST /release/register, true when the service accepted it. */
  register(signal?: AbortSignal): Promise<boolean>;
  /** POST /install, true when the service recorded it. */
  recordInstall(record: InstallRecord, signal?: AbortSignal): Promise<boolean>;
  /** POST /prepare: how this laptop's "Preparing your PROJEXA workspace" run is going (prepare-report.ts), true when the service recorded it. */
  reportPrepare(report: Record<string, unknown>, signal?: AbortSignal): Promise<boolean>;
  /**
   * current(); when the registry does not know this laptop's release, asks it to register it and reads current() again.
   * Returns the latest answer, or null when the registry cannot be reached.
   */
  ensureRegistered(signal?: AbortSignal): Promise<CurrentRelease | null>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRegistryFile(v: unknown): RegistryFile | null {
  if (!isObject(v)) return null;
  if (typeof v.path !== "string" || typeof v.sha256 !== "string") return null;
  const fileNo = Number(v.file_no);
  const fileVersion = Number(v.file_version);
  const size = Number(v.size);
  if (!Number.isFinite(fileNo) || !Number.isFinite(fileVersion) || !Number.isFinite(size)) return null;
  return { path: v.path, file_no: fileNo, file_version: fileVersion, sha256: v.sha256, size };
}

/** Anything that is not the contract's shape is "no answer" (null), never a half-trusted object. */
export function parseCurrentRelease(body: unknown): CurrentRelease | null {
  if (!isObject(body)) return null;
  let current: RegistryRelease | null = null;
  if (body.current !== null && body.current !== undefined) {
    const c = body.current;
    if (!isObject(c) || typeof c.release_version !== "string" || typeof c.manifest_sha256 !== "string" || !Array.isArray(c.files)) return null;
    const files = c.files.map(parseRegistryFile);
    if (files.some((f) => f === null)) return null;
    current = {
      release_version: c.release_version,
      manifest_sha256: c.manifest_sha256,
      built_at: typeof c.built_at === "string" ? c.built_at : "",
      files: files as RegistryFile[],
    };
  }
  return {
    current,
    min_compatible: typeof body.min_compatible === "string" ? body.min_compatible : null,
    registered: body.registered === true,
  };
}

export function createReleaseClient(options: ReleaseClientOptions): ReleaseClient {
  const base = (options.baseUrl ?? SYNC_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }, outer?: AbortSignal): Promise<{ ok: boolean; json: unknown }> {
    const token = await options.getAccessToken().catch(() => null);
    if (!token) return { ok: false, json: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const res = await doFetch(`${base}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "X-Px-Client": `${options.clientVersion?.() ?? "unknown"}; protocol=${SYNC_PROTOCOL}; schema=${options.schema ?? 0}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, json: null };
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* a body that is not JSON: the call itself still succeeded */
      }
      return { ok: true, json };
    } catch {
      return { ok: false, json: null };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  const client: ReleaseClient = {
    async current(signal) {
      const r = await call("/release/current", { method: "GET" }, signal);
      return r.ok ? parseCurrentRelease(r.json) : null;
    },
    async register(signal) {
      return (await call("/release/register", { method: "POST", body: {} }, signal)).ok;
    },
    async recordInstall(record, signal) {
      return (await call("/install", { method: "POST", body: record }, signal)).ok;
    },
    async reportPrepare(report, signal) {
      return (await call("/prepare", { method: "POST", body: report }, signal)).ok;
    },
    async ensureRegistered(signal) {
      const first = await client.current(signal);
      if (!first) return null;
      if (first.registered) return first;
      if (!(await client.register(signal))) return first;
      return (await client.current(signal)) ?? first;
    },
  };
  return client;
}
