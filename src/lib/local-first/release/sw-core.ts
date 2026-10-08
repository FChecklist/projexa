// LOCAL-FIRST release: the service worker's brain, as a pure, testable factory. src/app/sw.js/route.ts inlines the SOURCE of
// createSwCore() (Function.prototype.toString) into the script it serves, so this function must stay SELF-CONTAINED: no import,
// no reference to anything outside its own body except browser/worker globals (Response, URL, Promise, JSON). A test evaluates
// the inlined text in an isolated context (sw-core.test.ts) so a stray reference fails the build instead of a user's laptop.
//
// WHAT THE WORKER DOES (owner order 2026-10-02: PROJEXA keeps working with no internet, and with internet but our server down)
//
//   install     precaches NOTHING. The release is installed by the page (installer.ts), verified, and then the page tells the
//               worker `USE_RELEASE`. The worker only ever serves files from a release cache that passed verification.
//   fetch       GET only (a write is never touched), same-origin only (Supabase Auth / Edge Function calls go straight out),
//               never /api/** (never cached, never answered by the worker; if it fails, it fails and the app handles it),
//               never the installer's own requests (header X-Px-Install) or /_release/release.json (the mutable "latest" pointer).
//               Static assets (/_next/static/**, /_release/**, files with an extension: icons, logo, fonts) are CACHE-FIRST from
//               the active release cache, ignoring ?dpl= style query strings, else the network.
//               App navigations get the on-laptop /local shell from the active release cache when ANY of:
//                 - the browser says it is offline,
//                 - the network request fails,
//                 - our server answers 5xx,
//                 - a release is installed AND local-first mode is on (the shell is served FIRST, no request leaves the laptop).
//               otherwise network-first, so an online person without local-first mode sees exactly what they saw before.
//               With no release installed there is no shell: offline gets a small, calm page instead of a browser error.
//   static host (AUDIT-100 B60) when config.staticOrigin is set, a GET to THAT origin is treated exactly like a same-origin static
//               file: its path (minus staticPathPrefix) is looked up in the active release cache under the APP origin's path (the
//               installer stores every file under that key), else it goes to the network. The installer's own requests to the static
//               host (?<installParam>=1) and its release.json are never answered from the cache. Any other cross-origin request is untouched.
//   message     SKIP_WAITING, CLAIM, USE_RELEASE, SET_MODE, SET_PERSON, CLEAR_PERSON, STATUS (replied on the message port).
//
// PER-PERSON SAFETY. The worker remembers ONE record (cache `px-sw-meta`): which release is active, WHOSE it is (the signed-in
// person's id) and whether local-first mode is on. Sign-out sends CLEAR_PERSON. By default (AUDIT-100 A3, VERCEL_ROUTE_PLAN.md step 1b)
// it carries keepRelease: the release cache is KEPT but the record is marked signed out. Online, a signed-out laptop then behaves as before
// (no navigation is answered with the shell first: the server's pages, the login page, are what the person gets); its public static files
// are still served from the laptop. OFFLINE (AUDIT-100 B20) the kept release opens the shell, whose signed-out screen is the offline
// connection-needed notice (P1: no passcode; offline-pin.ts is retired). When the SAME person signs in again,
// USE_RELEASE / SET_PERSON make it active again and the 8.9 MB bundle is not downloaded again. ANOTHER person never gets it: their
// SET_PERSON or USE_RELEASE deletes it and they install their own (and the explicit "Sign out and delete this laptop's copy" sends no
// keepRelease: everything is deleted, as before). The release files themselves are public build output; no person's data is ever put
// in any cache by this worker (/api/** is never cached).
//
// ROBUSTNESS. Anything unexpected inside the worker falls back to the plain network request: a bug here must never make PROJEXA
// unusable for someone who is online.

export type SwCoreConfig = {
  releaseCachePrefix: string;
  metaCache: string;
  pointerUrl: string;
  shellUrl: string;
  /** Page paths that never need a session (exact), and prefixes; from src/lib/authz/page-access.ts. */
  publicExact: string[];
  publicPrefixes: string[];
  /** A page request carrying this query parameter wants the SERVER's page even in local-first mode (the shell's fallback for a module it does not have). */
  serverPageParam: string;
  /** Cache name prefixes of earlier worker generations, deleted on activate. */
  legacyCachePrefixes: string[];
  /**
   * AUDIT-100 B60: the separate static host (NEXT_PUBLIC_PX_STATIC_BASE, release-constants.ts) that serves /_next/static/**,
   * /_release/** and the public files instead of the app origin. Its origin ("https://projexa-static.pages.dev") and path prefix
   * ("" or "/px"). Empty / absent = no static host (every static file is same-origin, the behaviour before B60).
   */
  staticOrigin?: string;
  staticPathPrefix?: string;
  /** The installer's marker query parameter for its own static-host requests (release-constants.ts INSTALL_PARAM). */
  installParam?: string;
};

type SwEventLike = {
  waitUntil?: (p: Promise<unknown>) => void;
  respondWith?: (p: Promise<Response> | Response) => void;
  request?: Request;
  data?: unknown;
  ports?: readonly { postMessage: (m: unknown) => void }[];
  source?: { postMessage: (m: unknown) => void } | null;
};

export type SwScopeLike = {
  location: { origin: string };
  navigator?: { onLine?: boolean };
  caches: {
    open(name: string): Promise<{
      put(request: string, response: Response): Promise<void>;
      match(request: string | Request, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
    }>;
    has(name: string): Promise<boolean>;
    delete(name: string): Promise<boolean>;
    keys(): Promise<string[]>;
  };
  clients?: { claim(): Promise<void> };
  skipWaiting?: () => Promise<void>;
  fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
};

export type SwCore = {
  onInstall(event: SwEventLike): void;
  onActivate(event: SwEventLike): void;
  onFetch(event: SwEventLike): void;
  onMessage(event: SwEventLike): void;
};

export function createSwCore(scope: SwScopeLike, config: SwCoreConfig): SwCore {
  // signedOut: the person signed out and kept the release (CLEAR_PERSON keepRelease); nothing is served from it until they are back.
  type Pointer = { version: string; personId: string | null; localFirst: boolean; at: number; signedOut?: boolean };
  let pointerMemo: Pointer | null | undefined; // undefined = not read yet

  const releaseName = (version: string) => `${config.releaseCachePrefix}${version}`;

  async function readPointer(): Promise<Pointer | null> {
    if (pointerMemo !== undefined) return pointerMemo;
    try {
      if (!(await scope.caches.has(config.metaCache))) {
        pointerMemo = null;
        return null;
      }
      const cache = await scope.caches.open(config.metaCache);
      const hit = await cache.match(config.pointerUrl);
      const value = hit ? await hit.json() : null;
      pointerMemo = value && typeof value.version === "string" ? { version: value.version, personId: typeof value.personId === "string" ? value.personId : null, localFirst: value.localFirst === true, at: Number(value.at) || 0, signedOut: value.signedOut === true } : null;
    } catch {
      pointerMemo = null;
    }
    return pointerMemo;
  }

  async function writePointer(next: Pointer | null): Promise<void> {
    if (next === null) {
      pointerMemo = null;
      await scope.caches.delete(config.metaCache);
      return;
    }
    const cache = await scope.caches.open(config.metaCache);
    await cache.put(config.pointerUrl, new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } }));
    pointerMemo = next;
  }

  async function deleteReleaseCaches(except: string | null): Promise<void> {
    for (const name of await scope.caches.keys()) {
      if (name.startsWith(config.releaseCachePrefix) && name !== except) await scope.caches.delete(name);
    }
  }

  /** The active release's cache, or null. `caches.open` would CREATE a missing cache, so existence is checked first. */
  async function activeCache(pointer: Pointer | null) {
    if (!pointer) return null;
    const name = releaseName(pointer.version);
    if (!(await scope.caches.has(name))) return null;
    return scope.caches.open(name);
  }

  async function shellFor(pointer: Pointer | null): Promise<Response | null> {
    const cache = await activeCache(pointer);
    if (!cache) return null;
    const hit = await cache.match(config.shellUrl);
    return hit ? hit.clone() : null;
  }

  const isOffline = () => scope.navigator !== undefined && scope.navigator.onLine === false;
  const isLocalPath = (path: string) => path === config.shellUrl || path.startsWith(`${config.shellUrl}/`);
  const isPublicPage = (path: string) => config.publicExact.includes(path) || config.publicPrefixes.some((p) => path.startsWith(p));
  const hasExtension = (path: string) => path.slice(path.lastIndexOf("/") + 1).includes(".");
  const isStaticAsset = (path: string) => path.startsWith("/_next/static/") || path.startsWith("/_release/") || hasExtension(path);

  function offlinePage(): Response {
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PROJEXA</title></head>' +
      '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1c2b3a"><h1 style="font-size:1.25rem">PROJEXA is not saved on this laptop yet</h1>' +
      "<p>Open PROJEXA once while you are online. It will save itself to this laptop, and after that it keeps working without a connection.</p></body></html>";
    return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async function staticAsset(request: Request, cacheKey?: string): Promise<Response> {
    // a kept (signed-out) release's files are public build output: served from the laptop too
    const pointer = await readPointer();
    const cache = await activeCache(pointer);
    if (cache) {
      const hit = await cache.match(cacheKey ?? request, { ignoreSearch: true });
      if (hit) return hit;
    }
    return scope.fetch(request);
  }

  async function navigation(request: Request, path: string, wantsServerPage: boolean): Promise<Response> {
    const pointer = await readPointer();
    const app = isLocalPath(path) || !isPublicPage(path);
    // a kept (signed-out) release still has its shell: used when there is no network (its signed-out screen says a connection is needed for a first sign-in)
    const shell = await shellFor(pointer);

    // Served first, so no request leaves the laptop -- unless the shell itself sent the person here for a screen it does not have. Never for a
    // signed-out laptop: online it gets the server's pages (the login page) exactly as before.
    if (app && shell && pointer && !pointer.signedOut && pointer.localFirst && !wantsServerPage) return shell;
    if (isOffline()) return shell ?? offlinePage();

    let response: Response;
    try {
      response = await scope.fetch(request);
    } catch {
      return shell ?? offlinePage();
    }
    if (app && response.status >= 500 && shell) return shell; // our server is down or broken
    return response;
  }

  async function reply(event: SwEventLike, message: unknown): Promise<void> {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(message);
    else if (event.source) event.source.postMessage(message);
  }

  async function handleMessage(event: SwEventLike): Promise<void> {
    const data = (event.data ?? {}) as { type?: string; version?: unknown; personId?: unknown; localFirst?: unknown; keepRelease?: unknown };
    switch (data.type) {
      case "SKIP_WAITING": {
        if (scope.skipWaiting) await scope.skipWaiting();
        await reply(event, { ok: true, type: data.type });
        return;
      }
      case "CLAIM": {
        // A page that loaded while this worker was still activating can end up with an active worker but no controller (the claim at
        // activation ran before the new document existed). The prepare screen asks for the claim again so it never waits on a reload.
        if (scope.clients) await scope.clients.claim();
        await reply(event, { ok: true, type: data.type });
        return;
      }
      case "USE_RELEASE": {
        if (typeof data.version !== "string" || !data.version) {
          await reply(event, { ok: false, type: data.type, error: "no_version" });
          return;
        }
        if (!(await scope.caches.has(releaseName(data.version)))) {
          await reply(event, { ok: false, type: data.type, error: "no_cache" });
          return;
        }
        const before = await readPointer();
        const person = typeof data.personId === "string" && data.personId ? data.personId : null;
        // A release kept by a signed-out person is never handed to someone else: it is deleted, the new person installs their own.
        if (before && before.signedOut && before.personId && person && person !== before.personId) {
          await deleteReleaseCaches(null);
          await writePointer(null);
          await reply(event, { ok: false, type: data.type, error: "other_person" });
          return;
        }
        await writePointer({
          version: data.version,
          personId: person ?? (before ? before.personId : null),
          localFirst: typeof data.localFirst === "boolean" ? data.localFirst : before ? before.localFirst : false,
          at: Date.now(),
          // the person is named: they are signed in. Not named (a pass with nobody known): a kept, signed-out release stays signed out.
          signedOut: person ? false : before ? before.signedOut === true : false,
        });
        await deleteReleaseCaches(releaseName(data.version));
        await reply(event, { ok: true, type: data.type, version: data.version });
        return;
      }
      case "SET_MODE": {
        const before = await readPointer();
        if (!before) {
          await reply(event, { ok: false, type: data.type, error: "no_release" });
          return;
        }
        await writePointer({ ...before, localFirst: data.localFirst === true, at: Date.now() });
        await reply(event, { ok: true, type: data.type, localFirst: data.localFirst === true });
        return;
      }
      case "SET_PERSON": {
        const before = await readPointer();
        if (!before || typeof data.personId !== "string" || !data.personId) {
          await reply(event, { ok: false, type: data.type, error: "no_release_or_person" });
          return;
        }
        // A release installed for ANOTHER person is not handed to this one: it is dropped, the person installs their own.
        if (before.personId && before.personId !== data.personId) {
          await deleteReleaseCaches(null);
          await writePointer(null);
          await reply(event, { ok: true, type: data.type, cleared: true });
          return;
        }
        await writePointer({ ...before, personId: data.personId, at: Date.now(), signedOut: false });
        await reply(event, { ok: true, type: data.type, cleared: false });
        return;
      }
      case "CLEAR_PERSON": {
        const before = await readPointer();
        // keepRelease (the default sign-out): the SAME person's release stays on the laptop, no shell online until they sign in again; offline the shell's signed-out notice (P1).
        if (data.keepRelease === true && before && before.personId && typeof data.personId === "string" && before.personId === data.personId && (await scope.caches.has(releaseName(before.version)))) {
          await deleteReleaseCaches(releaseName(before.version));
          await writePointer({ ...before, signedOut: true, at: Date.now() });
          await reply(event, { ok: true, type: data.type, cleared: true, keptRelease: before.version });
          return;
        }
        // With no pointer there may still be release caches (a pointer lost to eviction): sign-out clears them too.
        if (!before || !before.personId || typeof data.personId !== "string" || before.personId === data.personId) {
          await deleteReleaseCaches(null);
          await writePointer(null);
          await reply(event, { ok: true, type: data.type, cleared: true });
          return;
        }
        await reply(event, { ok: true, type: data.type, cleared: false });
        return;
      }
      case "STATUS": {
        const pointer = await readPointer();
        const names = (await scope.caches.keys()).filter((n) => n.startsWith(config.releaseCachePrefix));
        // A kept, signed-out release is NOT active: version null (so every caller points the worker at it again for the person who is back),
        // and keptVersion / signedOut say what is there.
        const active = pointer && !pointer.signedOut ? pointer : null;
        await reply(event, {
          ok: true, type: data.type, version: active ? active.version : null, personId: pointer ? pointer.personId : null, localFirst: active ? active.localFirst : false,
          signedOut: Boolean(pointer && pointer.signedOut), keptVersion: pointer && pointer.signedOut ? pointer.version : null, caches: names,
        });
        return;
      }
      default:
        return;
    }
  }

  return {
    onInstall(event) {
      // Nothing to precache: the installer fills a release cache from a VERIFIED bundle. Take over at once; an old worker's
      // behaviour is not worth keeping alive beside this one.
      const done = scope.skipWaiting ? scope.skipWaiting() : Promise.resolve();
      if (event.waitUntil) event.waitUntil(done);
    },

    onActivate(event) {
      const work = (async () => {
        for (const name of await scope.caches.keys()) {
          if (config.legacyCachePrefixes.some((p) => name.startsWith(p))) await scope.caches.delete(name);
        }
        if (scope.clients) await scope.clients.claim();
      })();
      if (event.waitUntil) event.waitUntil(work);
    },

    onFetch(event) {
      const request = event.request;
      if (!request || !event.respondWith) return;
      if (request.method !== "GET") return; // a write is never the worker's business
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return;
      }
      if (url.origin !== scope.location.origin) {
        // AUDIT-100 B60: the static host serves this app's static files; an installed laptop answers them from its release.
        const prefix = config.staticPathPrefix || "";
        if (!config.staticOrigin || url.origin !== config.staticOrigin) return; // Supabase Auth, the sync Edge Function, anything not ours
        if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return;
        const staticPath = url.pathname.slice(prefix.length) || "/";
        if (config.installParam && url.searchParams.has(config.installParam)) return; // the installer's own fetch: fresh bytes
        if (request.headers && request.headers.get("x-px-install")) return;
        if (staticPath === "/_release/release.json") return;
        if (!isStaticAsset(staticPath)) return;
        const key = `${scope.location.origin}${staticPath}`;
        event.respondWith(staticAsset(request, key).catch(() => scope.fetch(request)));
        return;
      }
      const path = url.pathname;
      if (config.installParam && url.searchParams.has(config.installParam)) return; // the installer's own requests reach the network
      if (path === "/api" || path.startsWith("/api/")) return; // never cached, never served from here
      if (request.headers && request.headers.get("x-px-install")) return; // the installer's own fetches reach the network
      if (path === "/sw.js" || path === "/_release/release.json") return;

      if (request.mode === "navigate") {
        event.respondWith(navigation(request, path, url.searchParams.has(config.serverPageParam)).catch(() => scope.fetch(request)));
        return;
      }
      if (isStaticAsset(path)) {
        event.respondWith(staticAsset(request).catch(() => scope.fetch(request)));
      }
      // everything else (RSC payloads, /_next/image, data fetches): the network, untouched
    },

    onMessage(event) {
      const work = handleMessage(event).catch(async (err) => {
        await reply(event, { ok: false, error: String(err && (err as Error).message ? (err as Error).message : err) }).catch(() => {});
      });
      if (event.waitUntil) event.waitUntil(work);
    },
  };
}

/**
 * The text the route serves: the factory's source plus the wiring. `config` is JSON, so it can carry no code.
 * Written here (not in the route) so the test evaluates exactly what the browser will get.
 */
export function buildSwScript(config: SwCoreConfig, versionStamp: string): string {
  return [
    `// PROJEXA service worker ${JSON.stringify(versionStamp)} -- generated by src/app/sw.js/route.ts from src/lib/local-first/release/sw-core.ts`,
    `const createSwCore = ${createSwCore.toString()};`,
    `const core = createSwCore(self, ${JSON.stringify(config)});`,
    `self.addEventListener("install", (event) => core.onInstall(event));`,
    `self.addEventListener("activate", (event) => core.onActivate(event));`,
    `self.addEventListener("fetch", (event) => core.onFetch(event));`,
    `self.addEventListener("message", (event) => core.onMessage(event));`,
    "",
  ].join("\n");
}
