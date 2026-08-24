// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// hand-written service worker (not next-pwa/workbox -- this repo has zero
// existing SW/PWA tooling, and Next 15's App Router + Turbopack build
// output doesn't map cleanly onto next-pwa's expected webpack asset
// manifest; a small hand-written SW gives full control over exactly what's
// cached with zero extra build-step dependency, matching this codebase's
// general "prefer a small first-party module over a heavy framework
// plugin" convention seen elsewhere, e.g. pms-issue-service.ts's own
// hand-rolled dependency graph instead of a workflow-engine library).
//
// Scope: real offline APP-SHELL caching only -- the login/marketing pages
// and the authenticated shell's static assets, so a site worker who opens
// PROJEXA with no signal still gets *something* (not a browser's default
// offline error page) and can reach the offline work-progress queue UI
// (src/lib/offline/), which is itself IndexedDB-backed and needs no
// network. This does NOT cache API responses/data -- that's the queue's
// job, not the SW's; caching live API GETs here would risk silently
// serving stale organisation/project data with no invalidation story.
// R45 seq4 follow-up (platform.r43_queue seq4) -- CACHE_NAME bumped v1->v2
// (see `activate` below, which already purges any cache whose name isn't
// CACHE_NAME) specifically to force every already-installed client to drop
// its old cache on next activate, since the bug fixed below means some
// fraction of real production sessions may be holding cached entries for
// URLs this SW should never have cached in the first place.
const CACHE_NAME = "projexa-shell-v2";
const APP_SHELL_URLS = ["/", "/login", "/logo-mark.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// R45 seq4 follow-up bugfix (platform.r43_queue seq4): the previous version
// of this handler cache-first'd EVERY non-API, non-navigation same-origin
// GET -- which is not just "JS/CSS/fonts/images" as the old comment claimed.
// Next's App Router does its own client-side route transitions (sidebar
// <Link> clicks, router.push, etc.) via a `fetch()` to the route's own URL
// (e.g. GET /work-progress) carrying an `RSC`/`Next-Router-State-Tree`
// header -- NOT `request.mode === "navigate"`, so the old code fell through
// to the cache-first branch below and could cache an RSC PAYLOAD response
// under a plain route URL like "/work-progress". Any later request for that
// same URL -- including a real full-page navigation's own network-first
// fetch failing over, or another RSC fetch with different router-state
// headers -- could then be served that stale, header-mismatched payload
// from cache, desyncing the client's module tree from what the server
// actually rendered: a real, previously-undiagnosed vector for the
// "hydration mismatch on every route" symptom this cache was never meant to
// cause (see this file's own header comment: "does NOT cache API responses/
// data" was already the stated intent for exactly this reason -- RSC
// payloads are live data by the same logic, they just don't live under
// /api/). Fix: only cache-first true static build output under
// /_next/static/ (Next's own content-hashed, genuinely-immutable chunk/CSS/
// font URLs -- the ONLY case where "rarely changes" was ever actually true)
// and the fixed APP_SHELL_URLS above. Every other non-navigation GET
// (RSC payload fetches, /_next/image, etc.) now passes straight through to
// the network, uncached -- matching how this file already treats /api/.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
    );
    return;
  }

  const isImmutableBuildAsset = url.pathname.startsWith("/_next/static/");
  const isAppShellUrl = APP_SHELL_URLS.includes(url.pathname);
  if (!isImmutableBuildAsset && !isAppShellUrl) {
    // Not a content-hashed asset and not the fixed app shell -- e.g. an RSC
    // payload fetch for a route transition, or /_next/image. Always live,
    // never cached.
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
