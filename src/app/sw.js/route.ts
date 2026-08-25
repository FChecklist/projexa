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
//
// R46 (platform.r43_faults F_022/F_023): the navigate handler below carried
// an independent bug from this file's public/sw.js days, ported over
// verbatim by the F_015 move above (that move fixed cache INVALIDATION
// across deploys; it didn't touch this handler's own fallback logic) --
// real production repro: /ffe never rendered FF&E content, and separately
// /dashboard/hierarchy client-side "redirected" to /ffe within ~500ms of
// mount even though the route itself served a real 200 with no server
// Location header (ruling out a server redirect).
//
// Root cause: on a failed navigation, `caches.match(request).then((cached)
// => cached || caches.match("/"))` fell back to whatever this SW cached at
// INSTALL TIME for the app-shell route "/" -- which is itself a redirect
// target (src/app/page.tsx `redirect()`s a logged-in visitor to
// /dashboard), so the cached Response's own `.url`/`.redirected` describe
// /dashboard, not "/". Per the Fetch/Service Worker spec, when a service
// worker satisfies a NAVIGATION with a Response that was itself the product
// of a redirect, the browser adopts that Response's URL as the
// navigated-to URL -- i.e. serving this cached Response for a failed
// navigation to ANY other route (e.g. /ffe, /dashboard/hierarchy) silently
// carried the browser's address bar to wherever "/" last pointed, and with
// stale data ("No active projects yet" despite a real project existing --
// whatever "/" looked like at install time, not a live fetch), which is
// exactly what both faults reported. `fetch(request)` rejects (not just
// resolves with an error status) when the connection is torn down rather
// than answered -- exactly what a hard Vercel function-execution timeout
// does; Vercel's own runtime error logs show a real, confirmed "Task timed
// out after 300 seconds" incident on /dashboard, /dashboard/overview and
// /api/dashboard-hierarchy/.../dashboard in the hours immediately before
// these faults were filed (the server-side half of that incident was
// already fixed by veridian-client.ts's 20s fetchWithTimeout -- this is the
// client-side fallout of the same window). This also explains why
// fetch('/dashboard/hierarchy', {redirect:'manual'}) correctly showed a
// plain 200 with no Location header when F_023 was verified that way: a
// plain fetch() call isn't a navigation (request.mode isn't "navigate"), so
// it never goes through this handler at all -- only a real browser
// navigation (the actual repro path) does.
//
// Fix: never substitute a DIFFERENT route's cached content for a failed
// navigation. offlineNavigationFallback() below serves a freshly-built,
// same-URL, honest "couldn't reach PROJEXA -- Retry" response instead (no
// `.redirected`/foreign `.url` for the browser to adopt as a different
// address) -- no CACHE_NAME bump needed this time, since the F_015 fix
// above already makes every deploy's SW script (this one included)
// automatically supersede whatever any earlier deploy's SW cached.
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
  // online). R46 (platform.r43_faults F_022/F_023, see this file's route.ts
  // header for the full writeup): on a genuine network-level failure this
  // used to fall back to whatever "/" was cached as at install time --
  // which, because "/" itself redirects to /dashboard, silently carried the
  // browser to /dashboard (stale, install-time data) instead of the route
  // the user actually asked for. Never substitute a DIFFERENT route's
  // cached content for a failed navigation -- serve a same-URL, honest
  // fallback instead.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => offlineNavigationFallback(request))
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

// R46 (platform.r43_faults F_022/F_023): the honest, same-URL fallback for a
// navigation whose fetch() rejected at the network level -- see this file's
// route.ts header for the full root-cause writeup. Built fresh with the
// Response constructor -- NOT caches.match(...) of any cached page -- so it
// carries no .redirected/foreign .url for the browser to adopt as the
// navigated-to address. Status 200 (this IS the real response for this
// navigation, not an error the browser should chrome-decorate) with a Retry
// link back to the SAME url -- request.url already carries whatever path
// the user was trying to reach, so no route-specific knowledge is needed
// here for this to work for every route, present or future.
function offlineNavigationFallback(request) {
  const html = \`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connection problem — PROJEXA</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f6f5f2; color: #14213d; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  .card { max-width: 420px; text-align: center; }
  h1 { font-size: 1.15rem; margin-bottom: 8px; }
  p { font-size: 0.9rem; color: #5b6478; line-height: 1.5; }
  a { display: inline-block; margin-top: 16px; padding: 8px 20px; background: #14213d; color: #fff; border-radius: 8px; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <h1>Couldn't reach PROJEXA</h1>
    <p>This page didn't load -- your connection dropped or the request took too long. Nothing else has changed; try again.</p>
    <a href="\${request.url}">Retry</a>
  </div>
</body>
</html>\`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
`

export async function GET() {
  return new NextResponse(SW_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
