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
const CACHE_NAME = "projexa-shell-v1";
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

// Network-first for navigations (always prefer live content when online),
// falling back to the cached shell -- specifically the cached "/" -- only
// when the network genuinely fails. Non-navigation GETs (JS/CSS/fonts/
// images) use cache-first since they're content-hashed/rarely change.
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
