// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// R46 fix for F_015 (platform.r43_faults F_015): /sw.js used to be a static
// file at public/sw.js with a hand-bumped CACHE_NAME ("v1" -> "v2" in R45
// seq5, to purge caches poisoned by that release's RSC-payload-caching bug).
// That stopped the specific incident that was live at the time, but it only
// works if a human remembers to bump the version string on every future
// change to this file's caching logic -- miss that once and the exact same
// failure class (a browser's already-installed SW goes on serving whatever
// it cached under the OLD logic, because CACHE_NAME didn't change so
// `activate` below never purges it) reopens on the next deploy with no
// warning. Moved to a Next.js Route Handler -- the same convention
// src/app/manifest.ts already uses for a top-level "static-looking" file --
// specifically so CACHE_NAME can be derived from VERCEL_GIT_COMMIT_SHA, a
// Vercel-provided env var that is, by construction, different on every
// production deploy. That makes cache invalidation automatic and permanent:
// every deploy's SW ships a CACHE_NAME no earlier SW's `activate` handler
// has ever seen, so the "delete any cache key that isn't today's CACHE_NAME"
// logic below always fires on the very next activate, regardless of whether
// anyone remembered to touch this file. Falls back to a fixed string only
// for local/non-Vercel builds where that env var isn't set.
//
// Response carries an explicit `Cache-Control: no-cache` header (belt and
// braces on top of Next 16 route handlers already being dynamic/uncached by
// default) so browsers always revalidate the SW script itself against the
// network instead of serving a stale copy from the HTTP cache -- the other
// classic way an old SW keeps re-installing itself indefinitely.
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const CACHE_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? "local-dev"

const SW_SCRIPT = `
// Hand-written service worker (not next-pwa/workbox -- this repo has zero
// other PWA tooling, and Next's App Router + Turbopack build output doesn't
// map cleanly onto next-pwa's expected webpack asset manifest; a small
// hand-written SW gives full control over exactly what's cached with zero
// extra build-step dependency).
//
// Scope: real offline APP-SHELL caching only -- the login/marketing pages
// and the authenticated shell's static assets, so a site worker who opens
// PROJEXA with no signal still gets *something* (not a browser's default
// offline error page) and can reach the offline work-progress queue UI
// (src/lib/offline/), which is itself IndexedDB-backed and needs no
// network. This does NOT cache API responses/data -- that's the queue's
// job, not the SW's; caching live API GETs here would risk silently
// serving stale organisation/project data with no invalidation story.
//
// CACHE_NAME is stamped per-deploy (see route.ts, which generates this
// script) from VERCEL_GIT_COMMIT_SHA -- see \`activate\` below, which already
// purges any cache whose name isn't CACHE_NAME -- so every deploy
// automatically forces every already-installed client to drop whatever it
// cached under any earlier deploy's logic, with no manual version bump.
const CACHE_NAME = "projexa-shell-${CACHE_VERSION}";
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

// Only cache-first true static build output under /_next/static/ (Next's
// own content-hashed, genuinely-immutable chunk/CSS/font URLs -- the ONLY
// case where "rarely changes" is actually true) and the fixed
// APP_SHELL_URLS above. Every other non-navigation GET (RSC payload
// fetches for client-side route transitions, /_next/image, etc.) passes
// straight through to the network, uncached -- matching how this file
// already treats /api/. Caching an RSC payload response under a plain
// route URL like "/work-progress" is exactly what caused F_015: a later
// request for that same URL -- another RSC fetch with different
// router-state headers, or a real navigation's own fallback -- could then
// be served that stale, header-mismatched payload, displaying the wrong
// page's content at the right URL.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for real navigations (always prefer live content when
  // online), falling back to this request's own cache entry or, failing
  // that, the cached app shell "/" -- only when the network genuinely
  // fails (offline).
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
`

export async function GET() {
  return new NextResponse(SW_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
