import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { PUBLIC_PAGE_PATHS_FOR_TEST, PUBLIC_PAGE_PREFIXES_FOR_TEST } from "../../authz/page-access";
import { buildSwScript, createSwCore, type SwCore, type SwCoreConfig, type SwScopeLike } from "./sw-core";
import { RELEASE_CACHE_PREFIX, SHELL_URL, SW_META_CACHE, SW_POINTER_URL, releaseCacheName } from "./release-constants";
import { FakeCacheStorage } from "./__fixtures__/fakes";
import { SERVER_PAGE_PARAM } from "../shell/paths";

// The worker's brain, every branch of its fetch strategy. Each behaviour runs TWICE: against createSwCore() directly, and against
// the TEXT the service worker route serves (buildSwScript, evaluated in an isolated context that has only the worker's own
// globals). The second run is what proves createSwCore stays self-contained when it is inlined.

const ORIGIN = "https://projexa.test";
const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";

const CONFIG: SwCoreConfig = {
  releaseCachePrefix: RELEASE_CACHE_PREFIX,
  metaCache: SW_META_CACHE,
  pointerUrl: SW_POINTER_URL,
  shellUrl: SHELL_URL,
  publicExact: [...PUBLIC_PAGE_PATHS_FOR_TEST],
  publicPrefixes: [...PUBLIC_PAGE_PREFIXES_FOR_TEST],
  serverPageParam: SERVER_PAGE_PARAM,
  legacyCachePrefixes: ["projexa-shell-"],
};

type Net = (url: URL, request: Request) => Response | Promise<Response>;

function makeScope(net: Net = () => new Response("network", { status: 200 })) {
  const caches = new FakeCacheStorage();
  const fetched: string[] = [];
  const state = { online: true, skipped: 0, claimed: 0 };
  const scope = {
    location: { origin: ORIGIN },
    navigator: { get onLine() { return state.online; } },
    caches,
    clients: { claim: async () => { state.claimed += 1; } },
    skipWaiting: async () => { state.skipped += 1; },
    fetch: async (input: Request | string) => {
      const request = typeof input === "string" ? ({ url: input } as Request) : input;
      fetched.push(new URL(request.url).pathname + new URL(request.url).search);
      return net(new URL(request.url), request);
    },
  };
  return { scope: scope as unknown as SwScopeLike, caches, fetched, state };
}

type Handlers = { core: SwCore };

function directCore(scope: SwScopeLike): Handlers {
  return { core: createSwCore(scope, CONFIG) };
}

/** Evaluates the served script with ONLY the worker's globals available, and returns the handlers it registered. */
function inlinedCore(scope: SwScopeLike): Handlers {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = Object.assign(Object.create(null), scope, { addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; } });
  runInNewContext(buildSwScript(CONFIG, "test"), { self, Response, URL, JSON, Promise, Date, String, Number, Object, Error, Array });
  return {
    core: {
      onInstall: (e) => listeners.install!(e),
      onActivate: (e) => listeners.activate!(e),
      onFetch: (e) => listeners.fetch!(e),
      onMessage: (e) => listeners.message!(e),
    },
  };
}

const MODES: [string, (scope: SwScopeLike) => Handlers][] = [["createSwCore", directCore], ["inlined script", inlinedCore]];

function request(path: string, init: { mode?: string; method?: string; headers?: Record<string, string>; origin?: string } = {}): Request {
  return {
    url: new URL(path, init.origin ?? ORIGIN).href,
    method: init.method ?? "GET",
    mode: init.mode ?? (path.includes("_next") || /\.\w+$/.test(path.split("?")[0]!) ? "no-cors" : "navigate"),
    headers: new Headers(init.headers ?? {}),
  } as unknown as Request;
}

/** Fires a fetch event. `handled` false means the worker did not call respondWith (the browser goes to the network by itself). */
async function fire(core: SwCore, req: Request): Promise<{ handled: boolean; response?: Response }> {
  let promise: Promise<Response> | Response | undefined;
  core.onFetch({ request: req, respondWith: (p) => { promise = p; } });
  if (promise === undefined) return { handled: false };
  return { handled: true, response: await promise };
}

async function message(core: SwCore, data: unknown): Promise<any> {
  const replies: unknown[] = [];
  let pending: Promise<unknown> | undefined;
  core.onMessage({ data, ports: [{ postMessage: (m) => replies.push(m) }], waitUntil: (p) => { pending = p; } });
  await pending;
  return replies[0];
}

/** A release cache holding the shell and a few assets, as the installer would leave it. */
async function installRelease(caches: FakeCacheStorage, version = V1, extra: Record<string, string> = {}) {
  const cache = await caches.open(releaseCacheName(version));
  await cache.put(SHELL_URL, new Response(`<html>shell ${version}</html>`, { headers: { "content-type": "text/html" } }));
  await cache.put("/_next/static/chunks/app.js", new Response(`app ${version}`, { headers: { "content-type": "text/javascript" } }));
  await cache.put("/logo-mark.svg", new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
  for (const [path, body] of Object.entries(extra)) await cache.put(path, new Response(body));
}

for (const [label, make] of MODES) {
  describe(`service worker core (${label})`, () => {
    // ─── what the worker never touches ─────────────────────────────────────────────────────────
    describe("pass-through: the worker does not answer", () => {
      test("anything but a GET", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, personId: "p1", localFirst: true });
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          expect((await fire(core, request("/scope", { method, mode: "navigate" }))).handled).toBe(false);
        }
      });

      test("another origin: Supabase Auth and the sync Edge Function go straight out", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (const url of ["https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync/manifest", "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/token?grant_type=refresh_token", "https://fonts.example/x.woff2"]) {
          const r = request("/", { origin: new URL(url).origin });
          const req = { ...r, url, mode: "cors" } as unknown as Request;
          expect((await fire(core, req)).handled).toBe(false);
        }
      });

      test("/api/** is never cached and never answered, even with a release installed and local-first on", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (const path of ["/api/projects", "/api/scope/abc?x=1", "/api", "/api/shell"]) {
          for (const mode of ["cors", "same-origin", "navigate"]) {
            expect(`${path} ${mode} ${(await fire(core, request(path, { mode }))).handled}`).toBe(`${path} ${mode} false`);
          }
        }
        const meta = await caches.open(SW_META_CACHE);
        expect(await meta.match("/api/projects")).toBeUndefined();
      });

      test("the installer's own requests (X-Px-Install), /sw.js and /_release/release.json reach the network", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches, V1, { "/_release/release.json": "STALE" });
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        expect((await fire(core, request("/_next/static/chunks/app.js", { headers: { "X-Px-Install": "1" } }))).handled).toBe(false);
        expect((await fire(core, request("/local", { headers: { "x-px-install": "1" } }))).handled).toBe(false);
        expect((await fire(core, request("/sw.js", { mode: "same-origin" }))).handled).toBe(false);
        expect((await fire(core, request("/_release/release.json", { mode: "cors" }))).handled).toBe(false);
      });

      test("requests that are neither a page nor a static file (RSC payloads, /_next/image, data) go to the network untouched", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (const path of ["/scope?_rsc=abc", "/_next/image?url=%2Fa.png&w=64&q=75", "/dashboard/data"]) {
          expect((await fire(core, request(path, { mode: "cors" }))).handled).toBe(false);
        }
      });
    });

    // ─── static assets: cache-first from the ACTIVE release ─────────────────────────────────────
    describe("static assets are cache-first from the active release cache", () => {
      test("a hit is answered from the cache with NO network request", async () => {
        const { scope, caches, fetched } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        const js = await fire(core, request("/_next/static/chunks/app.js"));
        expect(js.handled).toBe(true);
        expect(await js.response!.text()).toBe(`app ${V1}`);
        const icon = await fire(core, request("/logo-mark.svg"));
        expect(await icon.response!.text()).toBe("<svg/>");
        expect(fetched).toEqual([]);
      });

      test("a ?dpl= style query string does not make it a miss", async () => {
        const { scope, caches, fetched } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        const hit = await fire(core, request("/_next/static/chunks/app.js?dpl=dpl_abc123"));
        expect(await hit.response!.text()).toBe(`app ${V1}`);
        expect(fetched).toEqual([]);
      });

      test("a miss goes to the network", async () => {
        const { scope, caches, fetched } = makeScope(() => new Response("from network"));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        const miss = await fire(core, request("/_next/static/chunks/new-chunk.js"));
        expect(await miss.response!.text()).toBe("from network");
        expect(fetched).toEqual(["/_next/static/chunks/new-chunk.js"]);
      });

      test("with no release installed everything static goes to the network", async () => {
        const { scope, fetched } = makeScope(() => new Response("from network"));
        const { core } = make(scope);
        const r = await fire(core, request("/_next/static/chunks/app.js"));
        expect(await r.response!.text()).toBe("from network");
        expect(fetched).toEqual(["/_next/static/chunks/app.js"]);
      });

      test("only the ACTIVE release's cache is read, never an older one that happens to linger", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches, V1);
        await installRelease(caches, V2);
        const { core } = make(scope);
        // a pointer to V2 written by USE_RELEASE, which also forgets V1
        await message(core, { type: "USE_RELEASE", version: V2 });
        expect(await (await fire(core, request("/_next/static/chunks/app.js"))).response!.text()).toBe(`app ${V2}`);
      });
    });

    // ─── navigations ────────────────────────────────────────────────────────────────────────────
    describe("app navigations", () => {
      test("no release: online it is the network's answer, untouched", async () => {
        const { scope, fetched } = makeScope(() => new Response("server page", { status: 200 }));
        const { core } = make(scope);
        const r = await fire(core, request("/scope"));
        expect(r.handled).toBe(true);
        expect(await r.response!.text()).toBe("server page");
        expect(fetched).toEqual(["/scope"]);
      });

      test("no release: offline, or the network throws, gets a calm page (503, no browser error), not a crash", async () => {
        const offline = makeScope();
        offline.state.online = false;
        const a = await fire(make(offline.scope).core, request("/scope"));
        expect(a.response!.status).toBe(503);
        expect(await a.response!.text()).toContain("not saved on this laptop yet");
        expect(offline.fetched).toEqual([]);
        const down = makeScope(() => { throw new TypeError("Failed to fetch"); });
        const b = await fire(make(down.scope).core, request("/scope"));
        expect(b.response!.status).toBe(503);
        expect(b.response!.headers.get("content-type")).toContain("text/html");
      });

      test("release installed, local-first OFF, online: network-first, and the server's page is what the person sees", async () => {
        const { scope, caches, fetched } = makeScope(() => new Response("server page"));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: false });
        const r = await fire(core, request("/scope/123"));
        expect(await r.response!.text()).toBe("server page");
        expect(fetched).toEqual(["/scope/123"]);
      });

      test("release installed: the network FAILS -> the shell", async () => {
        const { scope, caches } = makeScope(() => { throw new TypeError("Failed to fetch"); });
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: false });
        const r = await fire(core, request("/scope/123"));
        expect(await r.response!.text()).toBe(`<html>shell ${V1}</html>`);
      });

      test("release installed: OFFLINE -> the shell, without trying the network", async () => {
        const { scope, caches, fetched, state } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        state.online = false;
        const r = await fire(core, request("/work-progress"));
        expect(await r.response!.text()).toBe(`<html>shell ${V1}</html>`);
        expect(fetched).toEqual([]);
      });

      test("release installed: our server answers 5xx -> the shell; any other status is the server's own answer", async () => {
        for (const status of [500, 502, 503, 504, 599]) {
          const { scope, caches } = makeScope(() => new Response("boom", { status }));
          await installRelease(caches);
          const { core } = make(scope);
          await message(core, { type: "USE_RELEASE", version: V1 });
          const r = await fire(core, request("/scope"));
          expect(`${status}: ${await r.response!.text()}`).toBe(`${status}: <html>shell ${V1}</html>`);
        }
        for (const status of [200, 301, 307, 401, 403, 404, 429]) {
          const { scope, caches } = makeScope(() => new Response("server says", { status: status === 301 || status === 307 ? 200 : status }));
          await installRelease(caches);
          const { core } = make(scope);
          await message(core, { type: "USE_RELEASE", version: V1 });
          const r = await fire(core, request("/scope"));
          expect(`${status}: ${await r.response!.text()}`).toBe(`${status}: server says`);
        }
      });

      test("release installed AND local-first on: the shell is served FIRST and no request leaves the laptop", async () => {
        const { scope, caches, fetched } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (const path of ["/dashboard", "/scope", "/scope/abc-123", "/work-progress?projectId=p1", "/settings"]) {
          const r = await fire(core, request(path));
          expect(`${path}: ${await r.response!.text()}`).toBe(`${path}: <html>shell ${V1}</html>`);
        }
        expect(fetched).toEqual([]);
      });

      test("local-first on, but the shell sent the person to the SERVER's page (?px-server=1): network-first, shell only as the fallback", async () => {
        const online = makeScope(() => new Response("server page"));
        await installRelease(online.caches);
        const a = make(online.scope).core;
        await message(a, { type: "USE_RELEASE", version: V1, localFirst: true });
        const r = await fire(a, request(`/rfis/42?projectId=p1&${SERVER_PAGE_PARAM}=1`));
        expect(await r.response!.text()).toBe("server page");
        expect(online.fetched).toEqual([`/rfis/42?projectId=p1&${SERVER_PAGE_PARAM}=1`]);
        // and the same request when the server is down still ends in the shell, never in a browser error
        const down = makeScope(() => new Response("boom", { status: 503 }));
        await installRelease(down.caches);
        const b = make(down.scope).core;
        await message(b, { type: "USE_RELEASE", version: V1, localFirst: true });
        expect(await (await fire(b, request(`/rfis/42?${SERVER_PAGE_PARAM}=1`))).response!.text()).toBe(`<html>shell ${V1}</html>`);
        // without the marker the same URL is served from the laptop with no request
        down.fetched.length = 0;
        expect(await (await fire(b, request("/rfis/42"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
        expect(down.fetched).toEqual([]);
      });

      test("every answer is a fresh copy: the shell can be served again and again", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (let i = 0; i < 3; i += 1) expect(await (await fire(core, request("/scope"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
      });

      test("local-first on but the release has no shell file: falls back to the network, then the calm page", async () => {
        const { scope, caches } = makeScope(() => { throw new TypeError("Failed to fetch"); });
        const cache = await caches.open(releaseCacheName(V1));
        await cache.put("/_next/static/chunks/app.js", new Response("x"));
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        const r = await fire(core, request("/scope"));
        expect(r.response!.status).toBe(503);
      });

      test("a pointer to a cache the browser evicted counts as no release", async () => {
        const { scope, caches, fetched } = makeScope(() => new Response("server page"));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        await caches.delete(releaseCacheName(V1));
        const r = await fire(core, request("/scope"));
        expect(await r.response!.text()).toBe("server page");
        expect(fetched).toEqual(["/scope"]);
        expect(await caches.has(releaseCacheName(V1))).toBe(false); // looking did not re-create it
      });

      test("the /local shell route itself: local-first serves it, offline serves it, online without local-first uses the network", async () => {
        const { scope, caches, fetched, state } = makeScope(() => new Response("network /local"));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: false });
        expect(await (await fire(core, request("/local/scope/abc"))).response!.text()).toBe("network /local");
        state.online = false;
        expect(await (await fire(core, request("/local/scope/abc"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
        state.online = true;
        await message(core, { type: "SET_MODE", localFirst: true });
        fetched.length = 0;
        expect(await (await fire(core, request("/local"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
        expect(fetched).toEqual([]);
      });
    });

    describe("public pages are not the app", () => {
      test("local-first on, online: /login, /, /how-it-works, /auth/*, /invite/*, /share/* still come from the network", async () => {
        const { scope, caches, fetched } = makeScope(() => new Response("public page"));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
        for (const path of ["/login", "/signup", "/", "/how-it-works", "/auth/callback", "/invite/tok123", "/share/report/x", "/shared/mom/y", "/forgot-password"]) {
          expect(`${path}: ${await (await fire(core, request(path))).response!.text()}`).toBe(`${path}: public page`);
        }
        expect(fetched.length).toBe(9);
      });

      test("a public page that fails with 5xx is returned as the server sent it (the shell is for the app, not for the marketing site)", async () => {
        const { scope, caches } = makeScope(() => new Response("marketing broke", { status: 503 }));
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        const r = await fire(core, request("/how-it-works"));
        expect(r.response!.status).toBe(503);
        expect(await r.response!.text()).toBe("marketing broke");
      });

      test("offline, any page falls back to the shell (it says whether this laptop knows who you are)", async () => {
        const { scope, caches, state } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1 });
        state.online = false;
        expect(await (await fire(core, request("/login"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
      });
    });

    test("a bug inside the worker never breaks an online person: it falls back to the plain network request", async () => {
      const { scope, caches, fetched } = makeScope(() => new Response("plain network"));
      await installRelease(caches);
      const { core } = make(scope);
      await message(core, { type: "USE_RELEASE", version: V1, localFirst: true });
      (caches as unknown as { has: () => Promise<boolean> }).has = async () => { throw new Error("Cache Storage exploded"); };
      const nav = await fire(core, request("/scope"));
      expect(await nav.response!.text()).toBe("plain network");
      const asset = await fire(core, request("/_next/static/chunks/other.js"));
      expect(await asset.response!.text()).toBe("plain network");
      expect(fetched).toEqual(["/scope", "/_next/static/chunks/other.js"]);
    });

    // ─── lifecycle and messages ─────────────────────────────────────────────────────────────────
    describe("install and activate", () => {
      test("install precaches NOTHING (no cache is created) and takes over at once", async () => {
        const { scope, caches, state } = makeScope();
        const { core } = make(scope);
        let waited: Promise<unknown> | undefined;
        core.onInstall({ waitUntil: (p) => { waited = p; } });
        await waited;
        expect(state.skipped).toBe(1);
        expect(await caches.keys()).toEqual([]);
      });

      test("activate deletes only earlier worker generations' caches, keeps release caches and everyone else's, and claims the page", async () => {
        const { scope, caches, state } = makeScope();
        await caches.open("projexa-shell-abc");
        await caches.open("projexa-shell-local-dev");
        await installRelease(caches);
        await caches.open("unrelated");
        const { core } = make(scope);
        let waited: Promise<unknown> | undefined;
        core.onActivate({ waitUntil: (p) => { waited = p; } });
        await waited;
        expect((await caches.keys()).sort()).toEqual([releaseCacheName(V1), "unrelated"].sort());
        expect(state.claimed).toBe(1);
      });
    });

    describe("messages", () => {
      test("USE_RELEASE: points at the new release, forgets the older release caches, keeps every other cache", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches, V1);
        await installRelease(caches, V2);
        await caches.open("unrelated");
        const { core } = make(scope);
        const reply = await message(core, { type: "USE_RELEASE", version: V2, personId: "p1", localFirst: true });
        expect(reply).toMatchObject({ ok: true, version: V2 });
        expect((await caches.keys()).sort()).toEqual([releaseCacheName(V2), SW_META_CACHE, "unrelated"].sort());
        const status = await message(core, { type: "STATUS" });
        expect(status).toMatchObject({ ok: true, version: V2, personId: "p1", localFirst: true, caches: [releaseCacheName(V2)] });
      });

      test("USE_RELEASE for a release whose cache does not exist is refused and changes nothing", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches, V1);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, personId: "p1" });
        expect(await message(core, { type: "USE_RELEASE", version: V2 })).toMatchObject({ ok: false, error: "no_cache" });
        expect(await message(core, { type: "USE_RELEASE" })).toMatchObject({ ok: false, error: "no_version" });
        expect(await message(core, { type: "STATUS" })).toMatchObject({ version: V1 });
        expect(await caches.has(releaseCacheName(V2))).toBe(false);
      });

      test("the active release survives the worker being stopped and started again (it is remembered in Cache Storage)", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        await message(make(scope).core, { type: "USE_RELEASE", version: V1, personId: "p1", localFirst: true });
        const restarted = make(scope).core; // a fresh worker instance: no memory of the above
        expect(await message(restarted, { type: "STATUS" })).toMatchObject({ version: V1, personId: "p1", localFirst: true });
        expect(await (await fire(restarted, request("/scope"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
      });

      test("SET_MODE flips local-first and needs an installed release", async () => {
        const { scope, caches } = makeScope();
        const { core } = make(scope);
        expect(await message(core, { type: "SET_MODE", localFirst: true })).toMatchObject({ ok: false, error: "no_release" });
        await installRelease(caches);
        await message(core, { type: "USE_RELEASE", version: V1 });
        expect(await message(core, { type: "SET_MODE", localFirst: true })).toMatchObject({ ok: true, localFirst: true });
        expect(await message(core, { type: "STATUS" })).toMatchObject({ localFirst: true });
        await message(core, { type: "SET_MODE", localFirst: false });
        expect(await message(core, { type: "STATUS" })).toMatchObject({ localFirst: false });
        await message(core, { type: "SET_MODE", localFirst: "yes" }); // only a real boolean true turns it on
        expect(await message(core, { type: "STATUS" })).toMatchObject({ localFirst: false });
      });

      test("PER PERSON: a release belongs to the person it was installed for; sign-out (CLEAR_PERSON) deletes it", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, personId: "alice", localFirst: true });
        // someone else's sign-out message does not remove alice's release
        expect(await message(core, { type: "CLEAR_PERSON", personId: "bob" })).toMatchObject({ ok: true, cleared: false });
        expect(await caches.has(releaseCacheName(V1))).toBe(true);
        // alice signs out: every release cache and the pointer go
        expect(await message(core, { type: "CLEAR_PERSON", personId: "alice" })).toMatchObject({ ok: true, cleared: true });
        expect((await caches.keys())).toEqual([]);
        expect(await message(core, { type: "STATUS" })).toMatchObject({ version: null, personId: null, localFirst: false, caches: [] });
        // and the next navigation is a plain network one
        const net = await fire(core, request("/scope"));
        expect(await net.response!.text()).toBe("network");
      });

      test("CLEAR_PERSON with no pointer still removes stray release caches", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        expect(await message(core, { type: "CLEAR_PERSON", personId: "alice" })).toMatchObject({ cleared: true });
        expect(await caches.keys()).toEqual([]);
      });

      test("SET_PERSON: the same person keeps the release; a DIFFERENT person never inherits it (it is dropped)", async () => {
        const { scope, caches } = makeScope();
        await installRelease(caches);
        const { core } = make(scope);
        await message(core, { type: "USE_RELEASE", version: V1, personId: "alice" });
        expect(await message(core, { type: "SET_PERSON", personId: "alice" })).toMatchObject({ ok: true, cleared: false });
        expect(await caches.has(releaseCacheName(V1))).toBe(true);
        expect(await message(core, { type: "SET_PERSON", personId: "bob" })).toMatchObject({ ok: true, cleared: true });
        expect(await caches.keys()).toEqual([]);
      });

      test("SKIP_WAITING calls skipWaiting; an unknown message is ignored without a reply or an error", async () => {
        const { scope, state } = makeScope();
        const { core } = make(scope);
        expect(await message(core, { type: "SKIP_WAITING" })).toMatchObject({ ok: true });
        expect(state.skipped).toBe(1);
        expect(await message(core, { type: "NO_SUCH_THING" })).toBeUndefined();
        expect(await message(core, undefined)).toBeUndefined();
      });

      test("a reply goes to event.source when no port was given", async () => {
        const { scope } = makeScope();
        const { core } = make(scope);
        const replies: unknown[] = [];
        let pending: Promise<unknown> | undefined;
        core.onMessage({ data: { type: "STATUS" }, source: { postMessage: (m) => replies.push(m) }, waitUntil: (p) => { pending = p; } });
        await pending;
        expect(replies).toHaveLength(1);
      });
    });
  });
}

describe("the inlined worker script", () => {
  test("is plain text with the wiring and the config, and no module syntax", () => {
    const script = buildSwScript(CONFIG, "stamp-1");
    expect(script).toContain("self.addEventListener(\"fetch\"");
    expect(script).toContain("\"px-release-\"");
    expect(script).not.toMatch(/^\s*(import|export)\s/m);
    expect(() => new Function(script)).not.toThrow(); // it parses
  });

  test("the isolated context really is restricted, and a stray reference inside the worker is CONTAINED: the request still gets the plain network answer", async () => {
    const { scope, fetched } = makeScope(() => new Response("plain network"));
    const listeners: Record<string, (event: unknown) => void> = {};
    const self = Object.assign(Object.create(null), scope, { addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; } });
    // No Response in this context. The worker needs it for its calm offline page, so reaching that page throws a ReferenceError
    // INSIDE the worker; the fallback must turn that into the ordinary network request instead of a broken page.
    runInNewContext(buildSwScript(CONFIG, "x"), { self, URL, JSON, Promise, Date, String, Number, Object, Error, Array });
    let answer: Promise<Response> | undefined;
    const navigator = (scope as unknown as { navigator: object }).navigator;
    Object.defineProperty(navigator, "onLine", { value: false });
    listeners.fetch!({ request: request("/scope"), respondWith: (p: Promise<Response>) => { answer = p; } });
    expect(await (await answer!).text()).toBe("plain network");
    expect(fetched).toEqual(["/scope"]);
  });
});

describe("the worker survives minification", () => {
  test("bun's minifier renames the factory's inner names; the served text still behaves", async () => {
    const built = await Bun.build({ entrypoints: [new URL("./sw-core.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], minify: true, target: "browser", format: "esm" });
    expect(built.success).toBe(true);
    const code = await built.outputs[0]!.text();
    expect(code).not.toContain("pointerMemo"); // the inner names really were renamed
    const exported = /export\s*\{([^}]*)\}/.exec(code)!;
    const table = Object.fromEntries(exported[1]!.split(",").map((part) => { const [from, to] = part.trim().split(/\s+as\s+/); return [to ?? from, from]; }));
    const minified = runInNewContext(`${code.replace(/export\s*\{[^}]*\}\s*;?/, "")};({ buildSwScript: ${table.buildSwScript} })`, { Response, URL, JSON, Promise, Date, String, Number, Object, Error, Array }) as { buildSwScript: typeof buildSwScript };
    const script = minified.buildSwScript(CONFIG, "minified");
    expect(script).not.toContain("pointerMemo");

    const { scope, caches, fetched, state } = makeScope();
    await installRelease(caches);
    const listeners: Record<string, (event: unknown) => void> = {};
    const self = Object.assign(Object.create(null), scope, { addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; } });
    runInNewContext(script, { self, Response, URL, JSON, Promise, Date, String, Number, Object, Error, Array });
    const core: SwCore = { onInstall: (e) => listeners.install!(e), onActivate: (e) => listeners.activate!(e), onFetch: (e) => listeners.fetch!(e), onMessage: (e) => listeners.message!(e) };
    expect(await message(core, { type: "USE_RELEASE", version: V1, personId: "p1", localFirst: true })).toMatchObject({ ok: true });
    expect(await (await fire(core, request("/_next/static/chunks/app.js"))).response!.text()).toBe(`app ${V1}`);
    expect(await (await fire(core, request("/scope"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
    state.online = false;
    await message(core, { type: "SET_MODE", localFirst: false });
    expect(await (await fire(core, request("/scope"))).response!.text()).toBe(`<html>shell ${V1}</html>`);
    expect((await fire(core, request("/api/x", { mode: "cors" }))).handled).toBe(false);
    expect(fetched).toEqual([]);
  });
});
