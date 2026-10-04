// Test doubles for the release code: an in-memory Cache Storage, an in-memory meta store, and a fake origin that serves a
// release built by the REAL build script (scripts/make-release.mjs), so the installer is tested against real bundles.
import { createHash } from "node:crypto";
import { canonicalJson, gzipDeterministic, makeTar, PROTOCOL_VERSION } from "../../../../../scripts/make-release.mjs";
import type { CacheLike, CacheStorageLike, MetaStore } from "../installer";
import type { ReleaseManifest } from "../release-client";

const ORIGIN = "https://px.test";
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);

// ─── Cache Storage ──────────────────────────────────────────────────────────────────────────────

type Stored = { bytes: Uint8Array; headers: [string, string][]; status: number };

function keyOf(request: string | { url: string }): string {
  const url = new URL(typeof request === "string" ? request : request.url, ORIGIN);
  return url.pathname + url.search;
}

export class FakeCache implements CacheLike {
  readonly entries = new Map<string, Stored>();
  putCalls = 0;
  async put(request: string | { url: string }, response: Response): Promise<void> {
    this.putCalls += 1;
    this.entries.set(keyOf(request), { bytes: new Uint8Array(await response.clone().arrayBuffer()), headers: [...response.headers.entries()], status: response.status });
  }
  async match(request: string | { url: string }, options: { ignoreSearch?: boolean } = {}): Promise<Response | undefined> {
    const wanted = keyOf(request);
    const hit = options.ignoreSearch
      ? [...this.entries.entries()].find(([k]) => k.split("?")[0] === wanted.split("?")[0])?.[1]
      : this.entries.get(wanted);
    return hit ? new Response(hit.bytes as BlobPart, { status: hit.status, headers: hit.headers }) : undefined;
  }
  async keys(): Promise<readonly { url: string }[]> {
    return [...this.entries.keys()].map((k) => ({ url: `${ORIGIN}${k}` }));
  }
  async delete(request: string | { url: string }): Promise<boolean> {
    return this.entries.delete(keyOf(request));
  }
}

export class FakeCacheStorage implements CacheStorageLike {
  readonly caches = new Map<string, FakeCache>();
  failOpenFor: ((name: string) => boolean) | null = null;
  async open(name: string): Promise<FakeCache> {
    if (this.failOpenFor?.(name)) throw new Error("QuotaExceededError (fake)");
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  /** CacheStorage.match(): searches every cache in creation order. */
  async match(request: string | { url: string }, options: { ignoreSearch?: boolean } = {}): Promise<Response | undefined> {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  }
}

// ─── meta store ─────────────────────────────────────────────────────────────────────────────────

export class FakeMeta implements MetaStore {
  readonly data = new Map<string, unknown>();
  failSetFor: ((key: string) => boolean) | null = null;
  async getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    if (this.failSetFor?.(key)) throw new Error("meta write failed (fake)");
    this.data.set(key, value);
  }
}

// ─── a real release, built by the real script ───────────────────────────────────────────────────

export type FixtureFile = { path: string; text?: string; bytes?: Uint8Array };
export type BuiltRelease = {
  manifest: ReleaseManifest;
  bundle: Uint8Array;
  files: Map<string, Uint8Array>;
};

export function builtRelease(version: string, files: FixtureFile[], opts: { builtAt?: string } = {}): BuiltRelease {
  const entries = files.map((f) => ({ path: f.path, bytes: f.bytes ?? enc(f.text ?? "") })).sort((a, b) => (a.path < b.path ? -1 : 1));
  const bundle = new Uint8Array(gzipDeterministic(makeTar(entries)));
  const body = {
    release_version: version,
    git_sha: "abc123",
    built_at: opts.builtAt ?? "2026-10-02T09:30:00.000Z",
    protocol: PROTOCOL_VERSION,
    schema: 3,
    bundle: { path: `_release/px-${version}.tar.gz`, size: bundle.length, sha256: sha(bundle) },
    files: entries.map((f) => ({ path: f.path, size: f.bytes.length, sha256: sha(f.bytes) })),
  };
  const manifest = { ...body, manifest_sha256: sha(canonicalJson(body)) } as ReleaseManifest;
  return { manifest, bundle, files: new Map(entries.map((f) => [f.path, f.bytes])) };
}

/** A manifest with its digest recomputed, for tests that need a manifest that LIES but is internally consistent. */
export function resign(manifest: ReleaseManifest): ReleaseManifest {
  const { manifest_sha256: _old, ...body } = manifest;
  void _old;
  return { ...body, manifest_sha256: sha(canonicalJson(body)) } as ReleaseManifest;
}

export const fixtureFiles =(n: number, tag = "v1"): FixtureFile[] =>
  Array.from({ length: n }, (_, i) => ({ path: `_next/static/chunks/file-${String(i).padStart(2, "0")}.js`, text: `// file ${i} ${tag}\n`.padEnd(40, "x") }));

/** A fake origin: serves /_release/release.json, the bundle and every file by URL, and records what was asked. */
export type FakeOrigin = {
  fetch: typeof fetch;
  requests: string[];
  /** Serve this release from now on. */
  serve(release: BuiltRelease): void;
  /** Serve different bytes than the release lists for one path ("bundle" for the bundle itself). */
  tamper(path: string, bytes: Uint8Array): void;
  /** Make one path (or "bundle", "manifest") answer with this status. */
  fail(path: string, status: number): void;
  /** The init of every request, e.g. to check the X-Px-Install header. */
  inits: RequestInit[];
};

export function fakeOrigin(initial: BuiltRelease): FakeOrigin {
  let release = initial;
  const tampered = new Map<string, Uint8Array>();
  const failed = new Map<string, number>();
  const requests: string[] = [];
  const inits: RequestInit[] = [];
  const respond = (key: string, bytes: Uint8Array | undefined, type = "application/octet-stream") => {
    const status = failed.get(key);
    if (status) return new Response("fail", { status });
    if (!bytes) return new Response("missing", { status: 404 });
    return new Response((tampered.get(key) ?? bytes) as BlobPart, { status: 200, headers: { "content-type": type } });
  };
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    requests.push(path);
    inits.push(init ?? {});
    if (path === "/_release/release.json") {
      const status = failed.get("manifest");
      if (status) return new Response("fail", { status });
      return new Response(JSON.stringify(release.manifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path === `/${release.manifest.bundle.path}`) return respond("bundle", release.bundle);
    if (path === "/local") return respond("_shell/local.html", release.files.get("_shell/local.html"), "text/html");
    const rel = path.slice(1);
    return respond(rel, release.files.get(rel));
  }) as typeof fetch;
  return {
    fetch: doFetch,
    requests,
    inits,
    serve(next) {
      release = next;
      tampered.clear();
      failed.clear();
    },
    tamper(path, bytes) {
      tampered.set(path === "bundle" ? "bundle" : path, bytes);
    },
    fail(path, status) {
      failed.set(path, status);
    },
  };
}
