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
// specifically so the script can be stamped with VERCEL_GIT_COMMIT_SHA, a
// Vercel-provided env var that is, by construction, different on every
// production deploy, so a browser always sees a byte-different worker after a
// deploy and installs it. Falls back to a fixed string only for local/non-Vercel
// builds where that env var isn't set.
//
// Response carries an explicit `Cache-Control: no-cache` header (belt and
// braces on top of Next 16 route handlers already being dynamic/uncached by
// default) so browsers always revalidate the SW script itself against the
// network instead of serving a stale copy from the HTTP cache -- the other
// classic way an old SW keeps re-installing itself indefinitely.
//
// LOCAL-FIRST (owner order 2026-10-02, "PROJEXA keeps working with no internet / with our server down"):
// the worker's logic moved to src/lib/local-first/release/sw-core.ts, a pure factory with its own tests, and this route
// inlines its source. What changed in BEHAVIOUR:
//   * it precaches nothing at install any more: the app is installed by the page from ONE verified, versioned bundle
//     (src/lib/local-first/release/installer.ts) into Cache Storage `px-release-<version>`, and only then does the page
//     tell the worker to use it;
//   * /_next/static/** and other static files are cache-first from THAT release (no more runtime caching of whatever
//     happened to be fetched, which is what the F_015 poisoning was about -- an RSC payload is still never cached, and
//     /api/** is still never touched);
//   * an app navigation is answered with the on-laptop /local shell when the browser is offline, the network fails, our
//     server answers 5xx, or a release is installed and local-first mode is on; otherwise network-first as before.
// The old `projexa-shell-*` caches are deleted by `activate`.
import { NextResponse } from "next/server"
import { PUBLIC_PAGE_PATHS_FOR_TEST, PUBLIC_PAGE_PREFIXES_FOR_TEST } from "@/lib/authz/page-access"
import { RELEASE_CACHE_PREFIX, SHELL_URL, SW_META_CACHE, SW_POINTER_URL } from "@/lib/local-first/release/release-constants"
import { buildSwScript, type SwCoreConfig } from "@/lib/local-first/release/sw-core"

export const dynamic = "force-dynamic"

const CACHE_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? "local-dev"

const CONFIG: SwCoreConfig = {
  releaseCachePrefix: RELEASE_CACHE_PREFIX,
  metaCache: SW_META_CACHE,
  pointerUrl: SW_POINTER_URL,
  shellUrl: SHELL_URL,
  // The page gate's own lists, so the worker and the middleware cannot disagree about which pages need a session.
  publicExact: [...PUBLIC_PAGE_PATHS_FOR_TEST],
  publicPrefixes: [...PUBLIC_PAGE_PREFIXES_FOR_TEST],
  legacyCachePrefixes: ["projexa-shell-"],
}

const SW_SCRIPT = buildSwScript(CONFIG, CACHE_VERSION)

export async function GET() {
  return new NextResponse(SW_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
