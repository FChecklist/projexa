// LOCAL-FIRST release: installs ONE release on this laptop (docs/local-first/CONTRACT.md section 3).
//
//   1. read /_release/release.json and VERIFY its manifest digest (sha256 of the canonical JSON without manifest_sha256);
//   2. get the files: the ONE bundle, or -- when an older release is installed and fewer than half the files changed --
//      only the files whose sha256 changed, each from its own URL (the unchanged ones are copied from the old release's cache);
//   3. VERIFY EVERY file's sha256 and size (and the bundle's) against the manifest;
//   4. write them into Cache Storage `px-release-<version>`, store `app:release` and the file table `app:files` in the local
//      database meta, ask the service worker to switch to the new cache, delete the old one;
//   5. record the install with the registry (POST /install), best effort, retried later when it could not be sent.
//
// ONE RULE ABOVE ALL: any verification failure means NOTHING SWITCHES. The new cache is thrown away, the old release (cache,
// meta and service worker pointer) is exactly as it was, and the failure is recorded (status "failed"). A laptop is never left
// with half a release.
//
// Everything with a side effect is injected (fetch, Cache Storage, the meta store, the clock, the switch request, the
// registry call), so the whole thing is tested with fakes. The browser wiring is in persistence.ts / LocalFirstBoot.

import { readBundle, type Gunzip, type TarEntry } from "./bundle";
import { canonicalJson, sha256Hex } from "./canonical";
import {
  META_KEYS,
  RELEASE_CACHE_PREFIX,
  STATIC_BASE,
  contentTypeFor,
  installFetchUrl,
  releaseCacheName,
  urlForReleasePath,
} from "./release-constants";
import type { InstallRecord, RegistryRelease, ReleaseManifest } from "./release-client";

// ─── what the installer needs from the browser, as small interfaces ───────────────────────────────────

export type CacheLike = {
  put(request: string, response: Response): Promise<void>;
  match(request: string): Promise<Response | undefined>;
  keys(): Promise<readonly { url: string }[]>;
};

export type CacheStorageLike = {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
};

export type MetaStore = {
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
};

/** What `app:release` holds: the release this laptop runs. */
export type InstalledRelease = {
  version: string;
  manifest_sha256: string;
  git_sha: string | null;
  built_at: string;
  protocol: number;
  schema: number;
  downloaded_at: string;
  installed_at: string;
  files: number;
  bytes: number;
  mode: "full" | "partial";
};

/** One row of the file table `app:files`. file_no / file_version come from the registry and are null until it has numbered them. */
export type AppFileRow = {
  path: string;
  file_no: number | null;
  file_version: number | null;
  sha256: string;
  size: number;
  /** The release version this row belongs to. */
  version: string;
};

export type AppFileTable = { version: string; rows: AppFileRow[] };

export type InstallResult =
  | { status: "installed" | "updated"; version: string; mode: "full" | "partial"; downloadedFiles: number; bytes: number }
  | { status: "current"; version: string }
  | { status: "failed"; version: string | null; reason: InstallFailure; error: string };

export type InstallFailure =
  | "manifest_unreachable"
  | "manifest_invalid"
  | "manifest_digest"
  | "bundle_unreachable"
  | "bundle_hash"
  | "bundle_unreadable"
  | "file_hash"
  | "file_missing"
  | "file_unexpected"
  | "file_unreachable"
  | "version_collision"
  | "storage"
  | "switch"
  | "meta";

export type InstallerDeps = {
  fetchImpl?: typeof fetch;
  caches: CacheStorageLike;
  meta: MetaStore;
  now?: () => number;
  /** Where release.json is. Default: /_release/release.json on the static host (staticBase), or the app's own when there is none. */
  manifestUrl?: string;
  /**
   * The static host the release is downloaded from (AUDIT-100 B60, release-constants.ts STATIC_BASE). Default: this build's
   * NEXT_PUBLIC_PX_STATIC_BASE; "" = the app origin (the behaviour before B60). Only WHERE the bytes come from changes: every byte
   * is still checked against the manifest, and the cache keys are still the app-origin paths.
   */
  staticBase?: string;
  gunzip?: Gunzip;
  /** This laptop's random id (see getDeviceId). */
  deviceId: string;
  /** Asks the service worker to use `version` and forget the others; rejects when it cannot. */
  switchTo: (version: string) => Promise<void>;
  /** The registry's current numbering, when it could be had. Used for file_no / file_version of the stored table. */
  registry?: (wanted: { release_version: string; manifest_sha256: string }) => Promise<RegistryRelease | null>;
  /** POST /install; resolves false (never throws) when it could not be sent. */
  recordInstall?: (record: InstallRecord) => Promise<boolean>;
  /** P1: a bundle already downloaded (and verified) before sign-in finished, for exactly this manifest, or null. Hashes are re-checked here. */
  takePrewarmedBundle?: (manifest: ReleaseManifest) => Uint8Array | null;
};

const HEX64 = /^[0-9a-f]{64}$/;

class InstallError extends Error {
  readonly reason: InstallFailure;
  constructor(reason: InstallFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Throws InstallError("manifest_invalid") unless `value` has exactly the shape make-release.mjs writes. */
export function parseManifest(value: unknown): ReleaseManifest {
  const bad = (what: string) => new InstallError("manifest_invalid", `The release manifest is not valid (${what}).`);
  if (!isObject(value)) throw bad("not an object");
  const v = value;
  if (typeof v.release_version !== "string" || !/^\d{4}\.\d{2}\.\d{2}-\d{3}$/.test(v.release_version)) throw bad("release_version");
  if (typeof v.built_at !== "string") throw bad("built_at");
  if (!Number.isInteger(v.protocol) || !Number.isInteger(v.schema)) throw bad("protocol/schema");
  if (v.git_sha !== null && typeof v.git_sha !== "string") throw bad("git_sha");
  if (typeof v.manifest_sha256 !== "string" || !HEX64.test(v.manifest_sha256)) throw bad("manifest_sha256");
  const b = v.bundle;
  if (!isObject(b) || typeof b.path !== "string" || !Number.isInteger(b.size) || typeof b.sha256 !== "string" || !HEX64.test(b.sha256)) throw bad("bundle");
  if (!Array.isArray(v.files) || v.files.length === 0) throw bad("files");
  const seen = new Set<string>();
  for (const f of v.files) {
    if (!isObject(f) || typeof f.path !== "string" || !Number.isInteger(f.size) || (f.size as number) < 0 || typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) throw bad("a file entry");
    if (seen.has(f.path as string)) throw bad(`duplicate path ${String(f.path)}`);
    seen.add(f.path as string);
  }
  return v as unknown as ReleaseManifest;
}

/** True when the manifest's own digest is what its content hashes to. */
export async function manifestDigestOk(manifest: ReleaseManifest): Promise<boolean> {
  const { manifest_sha256, ...body } = manifest;
  return (await sha256Hex(canonicalJson(body))) === manifest_sha256;
}

/** A random id for this laptop, kept in the local database meta. */
export async function getDeviceId(meta: MetaStore, random: () => string = defaultRandomId): Promise<string> {
  const existing = await meta.getMeta<string>(META_KEYS.device);
  if (typeof existing === "string" && existing.length >= 8) return existing;
  const id = random();
  await meta.setMeta(META_KEYS.device, id);
  return id;
}

function defaultRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

function cachedResponse(path: string, version: string, bytes: Uint8Array): Response {
  return new Response(bytes as BlobPart, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(path),
      "Content-Length": String(bytes.length),
      "X-Px-Release": version,
    },
  });
}

async function deleteOtherReleaseCaches(caches: CacheStorageLike, keep: string): Promise<string[]> {
  const gone: string[] = [];
  for (const name of await caches.keys()) {
    if (name.startsWith(RELEASE_CACHE_PREFIX) && name !== releaseCacheName(keep)) {
      await caches.delete(name);
      gone.push(name);
    }
  }
  return gone;
}

/**
 * Installs the release the app currently serves, unless this laptop already has exactly it (same manifest digest and its cache
 * is complete). Never throws: every failure is a `failed` result and leaves the previous release untouched.
 */
export async function installRelease(deps: InstallerDeps): Promise<InstallResult> {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  const iso = (ms: number) => new Date(ms).toISOString();
  const startedAt = now();
  const previous = (await safeGet<InstalledRelease>(deps.meta, META_KEYS.release)) ?? null;
  const previousFiles = (await safeGet<AppFileTable>(deps.meta, META_KEYS.files)) ?? null;
  // The install fetches must reach the NETWORK, never the service worker's cache: the same URL can hold different bytes in the
  // old and the new release (an unhashed public file), and the bytes are about to be compared with the new manifest.
  // Same-origin they carry the X-Px-Install header; to a static host they carry ?px-install=1 instead (a custom header would make
  // every request a CORS preflight) and no credentials (the files are public).
  const staticBase = deps.staticBase ?? STATIC_BASE;
  const sameOriginOpts: RequestInit = { cache: "no-store", credentials: "same-origin", headers: { "X-Px-Install": "1" } };
  const fetchOpts: RequestInit = staticBase ? { cache: "no-store", credentials: "omit", mode: "cors" } : sameOriginOpts;
  const where = (urlPath: string) => installFetchUrl(staticBase, urlPath);
  const optsFor = (urlPath: string) => (where(urlPath) === urlPath ? sameOriginOpts : fetchOpts);

  let manifest: ReleaseManifest | null = null;
  let newCacheName: string | null = null;
  let switched = false;
  let metaWritten = false;
  let downloaded = 0;
  let bytesDownloaded = 0;

  try {
    // 1. the manifest, verified
    let manifestRes: Response;
    try {
      const manifestUrl = deps.manifestUrl ?? where("/_release/release.json");
      manifestRes = await doFetch(manifestUrl, manifestUrl.startsWith("/") ? sameOriginOpts : fetchOpts);
    } catch (err) {
      throw new InstallError("manifest_unreachable", `The release manifest could not be fetched (${errText(err)}).`);
    }
    if (!manifestRes.ok) throw new InstallError("manifest_unreachable", `The release manifest answered ${manifestRes.status}.`);
    let manifestJson: unknown;
    try {
      manifestJson = await manifestRes.json();
    } catch {
      throw new InstallError("manifest_invalid", "The release manifest is not JSON.");
    }
    manifest = parseManifest(manifestJson);
    if (!(await manifestDigestOk(manifest))) throw new InstallError("manifest_digest", "The release manifest does not match its own digest.");

    const version = manifest.release_version;

    // Already installed and complete: nothing to do.
    if (previous && previous.manifest_sha256 === manifest.manifest_sha256 && (await cacheIsComplete(deps.caches, manifest))) {
      return { status: "current", version };
    }
    // The same version number naming different content cannot be installed beside itself (one cache name per version): refuse
    // rather than overwrite the working release in place, and let the next build number fix it.
    if (previous && previous.version === version && previous.manifest_sha256 !== manifest.manifest_sha256 && (await deps.caches.has(releaseCacheName(version)))) {
      throw new InstallError("version_collision", `Release ${version} is already installed with different content.`);
    }
    newCacheName = releaseCacheName(version);

    // 2. which files must come over the network
    const oldCacheName = previous ? releaseCacheName(previous.version) : null;
    const oldCache = oldCacheName && (await deps.caches.has(oldCacheName)) ? await deps.caches.open(oldCacheName) : null;
    const oldSha = new Map((previousFiles && previous && previousFiles.version === previous.version ? previousFiles.rows : []).map((r) => [r.path, r.sha256]));
    const changed = manifest.files.filter((f) => oldSha.get(f.path) !== f.sha256);
    const partial = oldCache !== null && oldSha.size > 0 && changed.length * 2 < manifest.files.length;

    // A leftover of an earlier failed attempt at this same version is not trusted.
    if (await deps.caches.has(newCacheName)) await deps.caches.delete(newCacheName);
    const cache = await deps.caches.open(newCacheName);
    const write = async (path: string, bytes: Uint8Array) => {
      try {
        await cache.put(urlForReleasePath(path), cachedResponse(path, version, bytes));
      } catch (err) {
        throw new InstallError("storage", `The laptop could not store a file (${errText(err)}).`);
      }
    };

    if (partial && oldCache) {
      // 2b/3/4. unchanged files come from the old cache (re-hashed: a damaged old copy is fetched again), changed ones from their URL
      for (const file of manifest.files) {
        let bytes: Uint8Array | null = null;
        if (oldSha.get(file.path) === file.sha256) {
          const cached = await oldCache.match(urlForReleasePath(file.path));
          if (cached) {
            const candidate = await bytesOf(cached);
            if (candidate.length === file.size && (await sha256Hex(candidate)) === file.sha256) bytes = candidate;
          }
        }
        if (!bytes) {
          bytes = await fetchFile(doFetch, (urlPath) => [where(urlPath), optsFor(urlPath)], file.path);
          downloaded += 1;
          bytesDownloaded += bytes.length;
        }
        await verifyFile(file, bytes);
        await write(file.path, bytes);
      }
    } else {
      // 2a/3/4. the ONE bundle
      let bundleBytes: Uint8Array | null = deps.takePrewarmedBundle?.(manifest) ?? null;
      if (!bundleBytes) {
        let bundleRes: Response;
        try {
          bundleRes = await doFetch(where(`/${manifest.bundle.path}`), optsFor(`/${manifest.bundle.path}`));
        } catch (err) {
          throw new InstallError("bundle_unreachable", `The release bundle could not be fetched (${errText(err)}).`);
        }
        if (!bundleRes.ok) throw new InstallError("bundle_unreachable", `The release bundle answered ${bundleRes.status}.`);
        bundleBytes = await bytesOf(bundleRes);
      }
      if (bundleBytes.length !== manifest.bundle.size || (await sha256Hex(bundleBytes)) !== manifest.bundle.sha256) {
        throw new InstallError("bundle_hash", "The release bundle does not match the manifest (size or sha256).");
      }
      let entries: TarEntry[];
      try {
        entries = await readBundle(bundleBytes, deps.gunzip);
      } catch (err) {
        throw new InstallError("bundle_unreadable", errText(err));
      }
      const byPath = new Map<string, Uint8Array>(entries.map((e): [string, Uint8Array] => [e.path, e.bytes]));
      const listed = new Set(manifest.files.map((f) => f.path));
      for (const entry of entries) {
        if (!listed.has(entry.path)) throw new InstallError("file_unexpected", `The bundle holds a file the manifest does not list: ${entry.path}`);
      }
      for (const file of manifest.files) {
        const bytes = byPath.get(file.path);
        if (!bytes) throw new InstallError("file_missing", `The bundle lacks a file the manifest lists: ${file.path}`);
        await verifyFile(file, bytes);
      }
      for (const file of manifest.files) await write(file.path, byPath.get(file.path)!);
      downloaded = manifest.files.length;
      bytesDownloaded = bundleBytes.length;
    }

    // Belt and braces: the cache now holds exactly the files, nothing else.
    if (!(await cacheIsComplete(deps.caches, manifest))) throw new InstallError("storage", "The laptop's cache does not hold every file after writing.");

    // 4. meta, then the switch. Meta first so a failed switch can be undone from what is still in hand.
    const registry = deps.registry ? await deps.registry({ release_version: manifest.release_version, manifest_sha256: manifest.manifest_sha256 }).catch(() => null) : null;
    const numbering = registry && registry.manifest_sha256 === manifest.manifest_sha256 ? new Map(registry.files.map((f) => [f.path, f])) : new Map();
    const installedAt = now();
    const record: InstalledRelease = {
      version,
      manifest_sha256: manifest.manifest_sha256,
      git_sha: manifest.git_sha,
      built_at: manifest.built_at,
      protocol: manifest.protocol,
      schema: manifest.schema,
      downloaded_at: iso(startedAt),
      installed_at: iso(installedAt),
      files: manifest.files.length,
      bytes: manifest.files.reduce((n, f) => n + f.size, 0),
      mode: partial ? "partial" : "full",
    };
    const table: AppFileTable = {
      version,
      rows: manifest.files.map((f) => ({
        path: f.path,
        file_no: numbering.get(f.path)?.file_no ?? null,
        file_version: numbering.get(f.path)?.file_version ?? null,
        sha256: f.sha256,
        size: f.size,
        version,
      })),
    };
    try {
      metaWritten = true; // from here the catch below puts both keys back, even if only the first write went through
      await deps.meta.setMeta(META_KEYS.files, table);
      await deps.meta.setMeta(META_KEYS.release, record);
    } catch (err) {
      throw new InstallError("meta", `The release could not be recorded on this laptop (${errText(err)}).`);
    }
    try {
      await deps.switchTo(version);
      switched = true;
    } catch (err) {
      throw new InstallError("switch", `The service worker did not switch to the new release (${errText(err)}).`);
    }

    // The old release is forgotten only now that the new one is live.
    await deleteOtherReleaseCaches(deps.caches, version).catch(() => []);
    await deps.meta.setMeta(META_KEYS.releaseFailure, null).catch(() => {});

    const status: "installed" | "updated" = previous ? "updated" : "installed";
    const installRecord: InstallRecord = {
      device_id: deps.deviceId,
      release_version: version,
      manifest_sha256: manifest.manifest_sha256,
      previous_release: previous?.version ?? null,
      downloaded_at: iso(startedAt),
      installed_at: iso(installedAt),
      files: manifest.files.length,
      bytes: bytesDownloaded,
      status,
    };
    await report(deps, installRecord);
    return { status, version, mode: partial ? "partial" : "full", downloadedFiles: downloaded, bytes: bytesDownloaded };
  } catch (err) {
    const failure = err instanceof InstallError ? err : new InstallError("storage", errText(err));

    // Put everything back the way it was: nothing switched, the old release stays.
    if (metaWritten && !switched) {
      await deps.meta.setMeta(META_KEYS.release, previous).catch(() => {});
      await deps.meta.setMeta(META_KEYS.files, previousFiles).catch(() => {});
    }
    if (newCacheName && !switched) {
      const oldName = previous ? releaseCacheName(previous.version) : null;
      if (newCacheName !== oldName) await deps.caches.delete(newCacheName).catch(() => false);
    }
    const when = now();
    await deps.meta.setMeta(META_KEYS.releaseFailure, { at: iso(when), version: manifest?.release_version ?? null, reason: failure.reason, error: failure.message }).catch(() => {});
    await report(deps, {
      device_id: deps.deviceId,
      release_version: manifest?.release_version ?? previous?.version ?? "unknown",
      manifest_sha256: manifest?.manifest_sha256 ?? previous?.manifest_sha256 ?? "",
      previous_release: previous?.version ?? null,
      downloaded_at: iso(startedAt),
      installed_at: iso(when),
      files: manifest?.files.length ?? 0,
      bytes: bytesDownloaded,
      status: "failed",
      error: `${failure.reason}: ${failure.message}`.slice(0, 500),
    });
    return { status: "failed", version: manifest?.release_version ?? null, reason: failure.reason, error: failure.message };
  }
}

async function fetchFile(doFetch: typeof fetch, target: (urlPath: string) => [string, RequestInit], path: string): Promise<Uint8Array> {
  let res: Response;
  try {
    const [url, opts] = target(urlForReleasePath(path));
    res = await doFetch(url, opts);
  } catch (err) {
    throw new InstallError("file_unreachable", `A release file could not be fetched: ${path} (${errText(err)}).`);
  }
  if (!res.ok) throw new InstallError("file_unreachable", `A release file answered ${res.status}: ${path}.`);
  return bytesOf(res);
}

async function verifyFile(file: { path: string; size: number; sha256: string }, bytes: Uint8Array): Promise<void> {
  if (bytes.length !== file.size || (await sha256Hex(bytes)) !== file.sha256) {
    throw new InstallError("file_hash", `A release file does not match the manifest (size or sha256): ${file.path}`);
  }
}

async function cacheIsComplete(caches: CacheStorageLike, manifest: ReleaseManifest): Promise<boolean> {
  const name = releaseCacheName(manifest.release_version);
  if (!(await caches.has(name))) return false;
  try {
    const cache = await caches.open(name);
    const have = new Set((await cache.keys()).map((r) => new URL(r.url, "https://px.invalid").pathname));
    return manifest.files.every((f) => have.has(urlForReleasePath(f.path)));
  } catch {
    return false;
  }
}

async function safeGet<T>(meta: MetaStore, key: string): Promise<T | undefined> {
  try {
    return await meta.getMeta<T>(key);
  } catch {
    return undefined;
  }
}

/** Sends the install record; when it cannot be sent it is kept in meta and tried again by flushPendingInstall(). */
async function report(deps: InstallerDeps, record: InstallRecord): Promise<void> {
  if (!deps.recordInstall) return;
  let sent = false;
  try {
    sent = await deps.recordInstall(record);
  } catch {
    sent = false;
  }
  if (!sent) {
    const pending = (await safeGet<InstallRecord[]>(deps.meta, META_KEYS.installPending)) ?? [];
    await deps.meta.setMeta(META_KEYS.installPending, [...pending, record].slice(-20)).catch(() => {});
  }
}

/** Tries once to send the install records that could not be sent earlier. Returns how many were delivered. */
export async function flushPendingInstalls(meta: MetaStore, send: (record: InstallRecord) => Promise<boolean>): Promise<number> {
  const pending = (await safeGet<InstallRecord[]>(meta, META_KEYS.installPending)) ?? [];
  if (pending.length === 0) return 0;
  const rest: InstallRecord[] = [];
  let delivered = 0;
  for (const record of pending) {
    let ok = false;
    try {
      ok = await send(record);
    } catch {
      ok = false;
    }
    if (ok) delivered += 1;
    else rest.push(record);
  }
  await meta.setMeta(META_KEYS.installPending, rest).catch(() => {});
  return delivered;
}

/**
 * Fills in file_no / file_version of the stored file table once the registry has numbered the installed release (it may not have
 * when the install ran). Returns true when the table changed.
 */
export async function applyRegistryNumbers(meta: MetaStore, registry: RegistryRelease | null): Promise<boolean> {
  if (!registry) return false;
  const installed = await safeGet<InstalledRelease>(meta, META_KEYS.release);
  const table = await safeGet<AppFileTable>(meta, META_KEYS.files);
  if (!installed || !table || table.version !== installed.version || registry.manifest_sha256 !== installed.manifest_sha256) return false;
  const numbering = new Map(registry.files.map((f) => [f.path, f]));
  let changed = false;
  const rows = table.rows.map((row) => {
    const n = numbering.get(row.path);
    if (!n || n.sha256 !== row.sha256) return row;
    if (row.file_no === n.file_no && row.file_version === n.file_version) return row;
    changed = true;
    return { ...row, file_no: n.file_no, file_version: n.file_version };
  });
  if (changed) await meta.setMeta(META_KEYS.files, { ...table, rows });
  return changed;
}

/** True when meta says release V is installed but V's cache is gone or incomplete (the browser evicted it, or the user cleared site data). */
export async function installedCacheMissing(deps: { caches: CacheStorageLike; meta: MetaStore }): Promise<boolean> {
  const installed = await safeGet<InstalledRelease>(deps.meta, META_KEYS.release);
  if (!installed) return false; // nothing was ever installed: that is "not installed yet", not "missing"
  const name = releaseCacheName(installed.version);
  if (!(await deps.caches.has(name))) return true;
  const files = await safeGet<AppFileTable>(deps.meta, META_KEYS.files);
  if (!files || files.version !== installed.version) return false;
  try {
    const cache = await deps.caches.open(name);
    const have = new Set((await cache.keys()).map((r) => new URL(r.url, "https://px.invalid").pathname));
    return !files.rows.every((f) => have.has(urlForReleasePath(f.path)));
  } catch {
    return true;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
