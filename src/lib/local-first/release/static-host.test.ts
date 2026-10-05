import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { HEADERS, readTar, stageRelease, verifyManifest } from "../../../../scripts/stage-static-pages.mjs";
import { keepPrevious, main as publishMain, staticBaseFromEnv } from "../../../../scripts/publish-static-pages.mjs";
import { sha256Hex } from "../../../../scripts/make-release.mjs";
import { installRelease, type InstallerDeps } from "./installer";
import {
  INSTALL_PARAM,
  META_KEYS,
  RELEASE_CACHE_PREFIX,
  SHELL_FILE_PATH,
  SHELL_URL,
  SW_META_CACHE,
  SW_POINTER_URL,
  installFetchUrl,
  normalizeStaticBase,
  publicFileUrl,
  releaseCacheName,
  staticHostParts,
  urlForReleasePath,
} from "./release-constants";
import { buildSwScript, createSwCore, type SwCore, type SwCoreConfig, type SwScopeLike } from "./sw-core";
import { FakeCacheStorage, FakeMeta, builtRelease, fixtureFiles, type BuiltRelease } from "./__fixtures__/fakes";

// AUDIT-100 B60: the static files on a separate static host (a free Cloudflare Pages project) behind ONE switch,
// NEXT_PUBLIC_PX_STATIC_BASE. What must hold: the installer downloads from the static host (no request for a release file to the app
// origin, no CORS-preflight header), every byte is still verified against the manifest, the cache keys stay the app-origin paths (so the
// worker, the shell and every existing install are unchanged), the worker answers the static host's URLs from the installed release
// (offline works), the installer's own requests are never answered from the cache, and the upload folder holds exactly the verified bytes.

const APP = "https://projexa.test";
const STATIC = "https://projexa-static.pages.test";
const V1 = "2026.10.06-001";
const V2 = "2026.10.06-002";
const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));

describe("the switch: NEXT_PUBLIC_PX_STATIC_BASE", () => {
  test("only an absolute http(s) URL turns it on; anything else is the default (the app origin)", () => {
    expect(normalizeStaticBase(undefined)).toBe("");
    expect(normalizeStaticBase("")).toBe("");
    expect(normalizeStaticBase("   ")).toBe("");
    expect(normalizeStaticBase("projexa-static.pages.dev")).toBe(""); // no scheme: a typo, ignored
    expect(normalizeStaticBase("ftp://x.test")).toBe("");
    expect(normalizeStaticBase("https://x.test/?a=1")).toBe("");
    expect(normalizeStaticBase("https://projexa-static.pages.dev")).toBe("https://projexa-static.pages.dev");
    expect(normalizeStaticBase("https://projexa-static.pages.dev/")).toBe("https://projexa-static.pages.dev");
    expect(normalizeStaticBase(" https://cdn.test/px// ")).toBe("https://cdn.test/px");
    expect(staticHostParts("")).toEqual({ staticOrigin: "", staticPathPrefix: "" });
    expect(staticHostParts("https://cdn.test/px")).toEqual({ staticOrigin: "https://cdn.test", staticPathPrefix: "/px" });
  });

  test("installer URLs: the static host with the install marker; the shell (an app page) and the default stay on the app origin", () => {
    expect(installFetchUrl("", "/_release/release.json")).toBe("/_release/release.json");
    expect(installFetchUrl(STATIC, "/_release/release.json")).toBe(`${STATIC}/_release/release.json?${INSTALL_PARAM}=1`);
    expect(installFetchUrl(STATIC, "/_next/static/chunks/a.js")).toBe(`${STATIC}/_next/static/chunks/a.js?${INSTALL_PARAM}=1`);
    expect(installFetchUrl(STATIC, SHELL_URL)).toBe(SHELL_URL);
  });

  test("a public file the app's chrome shows (the logo) is on the static host only when the switch is on", () => {
    expect(publicFileUrl("/logo-mark.svg", "")).toBe("/logo-mark.svg");
    expect(publicFileUrl("/logo-mark.svg", STATIC)).toBe(`${STATIC}/logo-mark.svg`);
    expect(publicFileUrl("logo-mark.svg", STATIC)).toBe(`${STATIC}/logo-mark.svg`);
  });
});

// ─── the installer against two hosts ────────────────────────────────────────────────────────────

type Asked = { url: string; init: RequestInit };

/** Two hosts: the static host serves the release; the app origin serves ONLY the shell page (a release file asked of it is a 404). */
function twoHosts(initial: BuiltRelease) {
  let release = initial;
  const asked: Asked[] = [];
  const tampered = new Map<string, Uint8Array>();
  const dropped = new Set<string>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push({ url: raw, init: init ?? {} });
    const url = new URL(raw, APP);
    const serve = (key: string, bytes: Uint8Array | undefined) => {
      if (dropped.has(key) || !bytes) return new Response("missing", { status: 404 });
      return new Response((tampered.get(key) ?? bytes) as BlobPart, { status: 200 });
    };
    if (url.origin === APP) return url.pathname === SHELL_URL ? serve(SHELL_FILE_PATH, release.files.get(SHELL_FILE_PATH)) : new Response("not here", { status: 404 });
    if (url.origin !== STATIC) return new Response("unknown host", { status: 502 });
    if (url.pathname === "/_release/release.json") return new Response(JSON.stringify(release.manifest), { status: 200 });
    if (url.pathname === `/${release.manifest.bundle.path}`) return serve("bundle", release.bundle);
    return serve(url.pathname.slice(1), release.files.get(url.pathname.slice(1)));
  }) as typeof fetch;
  return {
    asked,
    fetchImpl,
    serve: (next: BuiltRelease) => { release = next; tampered.clear(); dropped.clear(); },
    tamper: (key: string) => {
      const bytes = key === "bundle" ? release.bundle : release.files.get(key)!;
      const copy = new Uint8Array(bytes);
      copy[copy.length - 3] ^= 0xff;
      tampered.set(key, copy);
    },
    drop: (key: string) => dropped.add(key),
  };
}

function laptop(hosts: ReturnType<typeof twoHosts>, staticBase: string) {
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const switched: string[] = [];
  const deps = (): InstallerDeps => ({ fetchImpl: hosts.fetchImpl, caches, meta, gunzip, deviceId: "dev-b60", staticBase, switchTo: async (v) => { switched.push(v); } });
  return { caches, meta, switched, install: () => installRelease(deps()) };
}

const files = () => [...fixtureFiles(8), { path: "logo-mark.svg", text: "<svg/>" }, { path: SHELL_FILE_PATH, text: "<html>shell</html>" }];

describe("the installer with a static host", () => {
  test("a first install fetches release.json and the bundle from the static host ONLY: no app-origin request, no preflight header, no credentials", async () => {
    const release = builtRelease(V1, files());
    const hosts = twoHosts(release);
    const l = laptop(hosts, STATIC);
    const result = await l.install();
    expect(result).toMatchObject({ status: "installed", version: V1, mode: "full" });
    expect(hosts.asked.map((a) => a.url)).toEqual([`${STATIC}/_release/release.json?${INSTALL_PARAM}=1`, `${STATIC}/${release.manifest.bundle.path}?${INSTALL_PARAM}=1`]);
    for (const a of hosts.asked) {
      expect(a.init.credentials).toBe("omit");
      expect(a.init.cache).toBe("no-store");
      expect(new Headers(a.init.headers).has("x-px-install")).toBe(false); // a custom header = a CORS preflight a static host does not answer
    }
    // the cache keys are the APP-origin paths, exactly as without a static host
    const cache = l.caches.caches.get(releaseCacheName(V1))!;
    expect([...cache.entries.keys()].sort()).toEqual(release.manifest.files.map((f) => urlForReleasePath(f.path)).sort());
    expect(l.switched).toEqual([V1]);
  });

  test("without the switch nothing changes: same-origin URLs with the X-Px-Install header (the behaviour before B60)", async () => {
    const release = builtRelease(V1, files());
    const asked: Asked[] = [];
    const hosts = twoHosts(release);
    const sameOrigin = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input);
      asked.push({ url: raw, init: init ?? {} });
      return hosts.fetchImpl(new URL(raw, STATIC).href, init); // the release lives at these paths
    }) as typeof fetch;
    const caches = new FakeCacheStorage();
    const result = await installRelease({ fetchImpl: sameOrigin, caches, meta: new FakeMeta(), gunzip, deviceId: "d", staticBase: "", switchTo: async () => {} });
    expect(result.status).toBe("installed");
    expect(asked.map((a) => a.url)).toEqual(["/_release/release.json", `/${release.manifest.bundle.path}`]);
    for (const a of asked) expect(new Headers(a.init.headers).get("x-px-install")).toBe("1");
  });

  test("an update fetches ONLY the changed files from the static host; the shell page comes from the app origin", async () => {
    const v1 = builtRelease(V1, files());
    const hosts = twoHosts(v1);
    const l = laptop(hosts, STATIC);
    expect((await l.install()).status).toBe("installed");
    const changed = files().map((f) => (f.path === "_next/static/chunks/file-03.js" ? { ...f, text: "// changed in v2" } : f.path === SHELL_FILE_PATH ? { ...f, text: "<html>shell v2</html>" } : f));
    const v2 = builtRelease(V2, changed);
    hosts.serve(v2);
    hosts.asked.length = 0;
    const result = await l.install();
    expect(result).toMatchObject({ status: "updated", version: V2, mode: "partial", downloadedFiles: 2 });
    expect(hosts.asked.map((a) => a.url).sort()).toEqual([`${STATIC}/_next/static/chunks/file-03.js?${INSTALL_PARAM}=1`, `${STATIC}/_release/release.json?${INSTALL_PARAM}=1`, SHELL_URL].sort());
  });

  test("the static host serving ONE wrong byte in the bundle: refused, nothing installed", async () => {
    const release = builtRelease(V1, files());
    const hosts = twoHosts(release);
    hosts.tamper("bundle");
    const l = laptop(hosts, STATIC);
    expect(await l.install()).toMatchObject({ status: "failed", reason: "bundle_hash" });
    expect(l.switched).toEqual([]);
    expect(await l.caches.keys()).toEqual([]);
    expect(l.meta.data.get(META_KEYS.release)).toBeFalsy();
  });

  test("the static host dropping the bundle, or a changed file of an update: refused, the old release stays", async () => {
    const v1 = builtRelease(V1, files());
    const hosts = twoHosts(v1);
    hosts.drop("bundle");
    const l = laptop(hosts, STATIC);
    expect(await l.install()).toMatchObject({ status: "failed", reason: "bundle_unreachable" });
    hosts.serve(v1);
    expect((await l.install()).status).toBe("installed");
    const v2 = builtRelease(V2, files().map((f) => (f.path === "_next/static/chunks/file-05.js" ? { ...f, text: "// v2" } : f)));
    hosts.serve(v2);
    hosts.drop("_next/static/chunks/file-05.js");
    expect(await l.install()).toMatchObject({ status: "failed", reason: "file_unreachable" });
    hosts.serve(v2);
    hosts.tamper("_next/static/chunks/file-05.js");
    expect(await l.install()).toMatchObject({ status: "failed", reason: "file_hash" });
    expect(l.switched).toEqual([V1]);
    expect(await l.caches.keys()).toEqual([releaseCacheName(V1)]);
  });
});

// ─── the service worker with a static host ──────────────────────────────────────────────────────

const SW_CONFIG: SwCoreConfig = {
  releaseCachePrefix: RELEASE_CACHE_PREFIX,
  metaCache: SW_META_CACHE,
  pointerUrl: SW_POINTER_URL,
  shellUrl: SHELL_URL,
  publicExact: ["/login"],
  publicPrefixes: [],
  serverPageParam: "px-server",
  legacyCachePrefixes: [],
  ...staticHostParts(STATIC),
  installParam: INSTALL_PARAM,
};

function swScope() {
  const caches = new FakeCacheStorage();
  const fetched: string[] = [];
  const state = { online: true };
  const scope = {
    location: { origin: APP },
    navigator: { get onLine() { return state.online; } },
    caches,
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    fetch: async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      fetched.push(url);
      if (!state.online) throw new TypeError("Failed to fetch");
      return new Response(`network ${url}`);
    },
  } as unknown as SwScopeLike;
  return { scope, caches, fetched, state };
}

function inlined(scope: SwScopeLike, config: SwCoreConfig): SwCore {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = Object.assign(Object.create(null), scope, { addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; } });
  runInNewContext(buildSwScript(config, "test"), { self, Response, URL, JSON, Promise, Date, String, Number, Object, Error, Array });
  return { onInstall: (e) => listeners.install!(e), onActivate: (e) => listeners.activate!(e), onFetch: (e) => listeners.fetch!(e), onMessage: (e) => listeners.message!(e) };
}

const req = (url: string, headers: Record<string, string> = {}, mode = "no-cors") => ({ url, method: "GET", mode, headers: new Headers(headers) }) as unknown as Request;

async function fire(core: SwCore, r: Request): Promise<{ handled: boolean; text?: string }> {
  let p: Promise<Response> | Response | undefined;
  core.onFetch({ request: r, respondWith: (x) => { p = x; } });
  if (p === undefined) return { handled: false };
  return { handled: true, text: await (await p).text() };
}

async function useRelease(core: SwCore) {
  let pending: Promise<unknown> | undefined;
  const replies: unknown[] = [];
  core.onMessage({ data: { type: "USE_RELEASE", version: V1, personId: "p1", localFirst: true }, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (x) => { pending = x; } });
  await pending;
  return replies[0];
}

for (const [label, make] of [["createSwCore", (s: SwScopeLike) => createSwCore(s, SW_CONFIG)], ["inlined script", (s: SwScopeLike) => inlined(s, SW_CONFIG)]] as const) {
  describe(`the service worker answers the static host from the installed release (${label})`, () => {
    test("offline: a static-host chunk, font and public file are served from the release cache (keyed by the app-origin path)", async () => {
      const { scope, caches, fetched, state } = swScope();
      const cache = await caches.open(releaseCacheName(V1));
      await cache.put("/_next/static/chunks/app.js", new Response("app v1"));
      await cache.put("/_next/static/media/inter.woff2", new Response("font v1"));
      await cache.put("/logo-mark.svg", new Response("<svg/>"));
      const core = make(scope);
      expect(await useRelease(core)).toMatchObject({ ok: true });
      state.online = false;
      expect(await fire(core, req(`${STATIC}/_next/static/chunks/app.js?dpl=abc`))).toEqual({ handled: true, text: "app v1" });
      expect(await fire(core, req(`${STATIC}/_next/static/media/inter.woff2`, {}, "cors"))).toEqual({ handled: true, text: "font v1" });
      expect(await fire(core, req(`${STATIC}/logo-mark.svg`))).toEqual({ handled: true, text: "<svg/>" });
      expect(fetched).toEqual([]); // nothing left the laptop
    });

    test("a static-host file the release does not hold goes to the network (the static host)", async () => {
      const { scope, caches, fetched } = swScope();
      await caches.open(releaseCacheName(V1));
      const core = make(scope);
      await useRelease(core);
      expect(await fire(core, req(`${STATIC}/_next/static/chunks/new.js`))).toEqual({ handled: true, text: `network ${STATIC}/_next/static/chunks/new.js` });
      expect(fetched).toEqual([`${STATIC}/_next/static/chunks/new.js`]);
    });

    test("the installer's own static-host requests, and release.json, are never answered from the cache", async () => {
      const { scope, caches } = swScope();
      const cache = await caches.open(releaseCacheName(V1));
      await cache.put("/_next/static/chunks/app.js", new Response("STALE"));
      await cache.put("/_release/release.json", new Response("STALE"));
      const core = make(scope);
      await useRelease(core);
      expect((await fire(core, req(`${STATIC}/_next/static/chunks/app.js?${INSTALL_PARAM}=1`, {}, "cors"))).handled).toBe(false);
      expect((await fire(core, req(`${STATIC}/_release/release.json`, {}, "cors"))).handled).toBe(false);
      expect((await fire(core, req(`/_next/static/chunks/app.js?${INSTALL_PARAM}=1`.replace(/^/, APP), {}, "cors"))).handled).toBe(false);
    });

    test("any OTHER cross-origin request is still untouched (Supabase, fonts elsewhere), and a non-static path on the static host too", async () => {
      const { scope, caches } = swScope();
      const cache = await caches.open(releaseCacheName(V1));
      await cache.put("/_next/static/chunks/app.js", new Response("app v1"));
      const core = make(scope);
      await useRelease(core);
      expect((await fire(core, req("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync/manifest", {}, "cors"))).handled).toBe(false);
      expect((await fire(core, req("https://other.test/_next/static/chunks/app.js"))).handled).toBe(false);
      expect((await fire(core, req(`${STATIC}/dashboard`, {}, "navigate"))).handled).toBe(false);
    });
  });
}

test("a path prefix on the static host is stripped before the cache lookup", async () => {
  const { scope, caches, state } = swScope();
  const cache = await caches.open(releaseCacheName(V1));
  await cache.put("/_next/static/chunks/app.js", new Response("app v1"));
  const core = createSwCore(scope, { ...SW_CONFIG, ...staticHostParts("https://cdn.test/px") });
  await useRelease(core);
  state.online = false;
  expect(await fire(core, req("https://cdn.test/px/_next/static/chunks/app.js"))).toEqual({ handled: true, text: "app v1" });
  expect((await fire(core, req("https://cdn.test/other/_next/static/chunks/app.js"))).handled).toBe(false);
});

test("with NO static host configured the worker ignores every cross-origin request (the behaviour before B60)", async () => {
  const { scope, caches } = swScope();
  const cache = await caches.open(releaseCacheName(V1));
  await cache.put("/_next/static/chunks/app.js", new Response("app v1"));
  const core = createSwCore(scope, { ...SW_CONFIG, staticOrigin: "", staticPathPrefix: "" });
  await useRelease(core);
  expect((await fire(core, req(`${STATIC}/_next/static/chunks/app.js`))).handled).toBe(false);
});

// ─── the upload folder ──────────────────────────────────────────────────────────────────────────

describe("scripts/stage-static-pages.mjs: the Pages upload folder is exactly the verified release", () => {
  const release = builtRelease(V1, files());
  const manifestBytes = Buffer.from(JSON.stringify(release.manifest, null, 2));
  const tmp = () => mkdtempSync(join(tmpdir(), "px-b60-stage-"));

  test("every file at its app path with its exact bytes, release.json and the bundle byte for byte, _headers and a 404 page; no shell", () => {
    const out = join(tmp(), "out");
    try {
      const summary = stageRelease({ manifestBytes, bundleBytes: Buffer.from(release.bundle), outDir: out });
      expect(summary).toMatchObject({ release_version: V1, manifest_sha256: release.manifest.manifest_sha256, files: release.manifest.files.length - 1 });
      for (const f of release.manifest.files) {
        const full = join(out, ...f.path.split("/"));
        if (f.path === SHELL_FILE_PATH) expect(existsSync(full)).toBe(false);
        else expect(Buffer.from(readFileSync(full)).equals(Buffer.from(release.files.get(f.path)!))).toBe(true);
      }
      expect(readFileSync(join(out, "_release", "release.json")).equals(manifestBytes)).toBe(true);
      expect(Buffer.from(readFileSync(join(out, ...release.manifest.bundle.path.split("/")))).equals(Buffer.from(release.bundle))).toBe(true);
      expect(readFileSync(join(out, "_headers"), "utf8")).toBe(HEADERS);
      expect(existsSync(join(out, "404.html"))).toBe(true);
      expect(readdirSync(out).sort()).toEqual(["404.html", "_headers", "_next", "_release", "logo-mark.svg"]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("_headers: CORS once for every file, immutable for hashed code and bundles, release.json revalidated", () => {
    const rules = HEADERS.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules.filter((l) => /Access-Control-Allow-Origin/i.test(l))).toEqual(["  Access-Control-Allow-Origin: *"]);
    expect(HEADERS).toMatch(/\/_next\/static\/\*\n {2}! Cache-Control\n {2}Cache-Control: public, max-age=31536000, immutable/);
    expect(HEADERS).toMatch(/\/_release\/release\.json\n {2}! Cache-Control\n {2}Cache-Control: no-cache/);
  });

  test("refuses a wrong byte in the bundle, a manifest that lies about itself, and a bundle file the manifest does not list", () => {
    const out = join(tmp(), "out");
    const bad = Buffer.from(release.bundle);
    bad[bad.length - 5] ^= 0xff;
    expect(() => stageRelease({ manifestBytes, bundleBytes: bad, outDir: out })).toThrow(/^bundle_hash/);
    const lying = Buffer.from(JSON.stringify({ ...release.manifest, release_version: V2 }));
    expect(() => stageRelease({ manifestBytes: lying, bundleBytes: Buffer.from(release.bundle), outDir: out })).toThrow(/^manifest_digest/);
    const other = builtRelease(V1, [...files(), { path: "extra.txt", text: "not listed" }]);
    expect(() => stageRelease({ manifestBytes, bundleBytes: Buffer.from(other.bundle), outDir: out })).toThrow(/^bundle_hash/);
    expect(existsSync(out)).toBe(false); // nothing written on a refusal
  });
});

describe("scripts/publish-static-pages.mjs (postbuild): a no-op unless the switch is on; keeps the previous release's code", () => {
  test("switch off (production today): skipped, exit 0, nothing staged or uploaded", async () => {
    expect(staticBaseFromEnv({})).toBe("");
    expect(staticBaseFromEnv({ NEXT_PUBLIC_PX_STATIC_BASE: "not a url" })).toBe("");
    expect(staticBaseFromEnv({ NEXT_PUBLIC_PX_STATIC_BASE: "https://projexa-static.pages.dev/" })).toBe("https://projexa-static.pages.dev");
    const dir = join(mkdtempSync(join(tmpdir(), "px-b60-pub-")), "never");
    expect(await publishMain(["--out", dir], {})).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  test("the previous release's /_next/static files the new build lacks are added; existing files are never overwritten; a tampered previous bundle stops it", () => {
    const prev = builtRelease(V1, [...fixtureFiles(3, "old"), { path: "_next/static/chunks/only-old.js", text: "// only in v1" }, { path: "logo-mark.svg", text: "<svg old/>" }]);
    const next = builtRelease(V2, [...fixtureFiles(3, "new"), { path: "logo-mark.svg", text: "<svg new/>" }]);
    const out = join(mkdtempSync(join(tmpdir(), "px-b60-keep-")), "out");
    try {
      stageRelease({ manifestBytes: Buffer.from(JSON.stringify(next.manifest)), bundleBytes: Buffer.from(next.bundle), outDir: out });
      const kept = keepPrevious({ outDir: out, manifestBytes: Buffer.from(JSON.stringify(prev.manifest)), bundleBytes: Buffer.from(prev.bundle), verifyManifest, readTar, sha256Hex });
      // fixtureFiles use the same names in both releases (new bytes win); only-old.js is the one file only v1 had
      expect(kept).toEqual({ previous_release: V1, kept: 1 });
      expect(readFileSync(join(out, "_next", "static", "chunks", "only-old.js"), "utf8")).toBe("// only in v1");
      expect(readFileSync(join(out, "_next", "static", "chunks", "file-00.js"), "utf8")).toContain("new");
      expect(readFileSync(join(out, "logo-mark.svg"), "utf8")).toBe("<svg new/>");
      const bad = Buffer.from(prev.bundle);
      bad[bad.length - 4] ^= 0xff;
      expect(() => keepPrevious({ outDir: out, manifestBytes: Buffer.from(JSON.stringify(prev.manifest)), bundleBytes: bad, verifyManifest, readTar, sha256Hex })).toThrow(/does not match/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
