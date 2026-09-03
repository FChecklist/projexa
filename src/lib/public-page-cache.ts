// R67 J-01 (audit R-246) -- the transport half of "the public site is
// static".
//
// The two marketing routes are the only pages in this app that render the
// same document for every visitor (see src/app/page.tsx and
// src/app/how-it-works/page.tsx: `dynamic = "force-static"`, `revalidate =
// 3600`, and no request-time read in either). Those two facts are what make
// them cacheable by a shared cache at all; this module is the header that
// tells one to do it.
//
// It lives in src/ rather than inline in next.config.ts so it can be
// asserted by a test -- next.config.ts itself is loaded by Next's own
// config compiler, not by `bun test`.
//
// The route list is exact, never a pattern: every other route in this app is
// either authenticated or an API, and `stale-while-revalidate` on one of
// those would let a shared cache hand one tenant's HTML to another.

export const STATIC_PUBLIC_ROUTES = ["/", "/how-it-works"] as const;

/**
 * s-maxage (shared caches only, so a CDN serves the hourly-revalidated copy)
 * plus a day of stale-while-revalidate, so an expiring entry is refreshed in
 * the background instead of making one visitor wait for the re-render.
 */
export const PUBLIC_PAGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

export type PublicPageHeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

/** The exact array next.config.ts's `headers()` returns. */
export function publicPageHeaderRules(): PublicPageHeaderRule[] {
  return STATIC_PUBLIC_ROUTES.map((source) => ({
    source,
    headers: [{ key: "Cache-Control", value: PUBLIC_PAGE_CACHE_CONTROL }],
  }));
}
