// R67 J-01 (audit R-246) -- the routing and transport half of "the public
// site is static".
//
// The marketing routes are the only pages in this app that render the same
// document for every visitor in a given locale (see src/app/page.tsx,
// src/app/hi/page.tsx and their /how-it-works siblings: `dynamic =
// "force-static"`, `revalidate = 3600`, and no request-time read in any of
// them). That is what makes them cacheable by a shared cache at all; this
// module holds the header that tells one to do it, and the map that says
// which document belongs to which locale.
//
// It lives in src/ rather than inline in next.config.ts so it can be
// asserted by a test -- next.config.ts itself is loaded by Next's own config
// compiler, not by `bun test`.
//
// The route list is exact, never a pattern: every other route in this app is
// either authenticated or an API, and `stale-while-revalidate` on one of
// those would let a shared cache hand one tenant's HTML to another.
//
// It imports ../i18n/locales and nothing else, because middleware.ts imports
// this file and runs in the Edge runtime.

import { DEFAULT_LOCALE, type SupportedLocale } from "../i18n/locales";

/**
 * The canonical (default-locale) URL of each public marketing page, mapped to
 * the prerendered document for every supported locale.
 *
 * `satisfies Record<string, Record<SupportedLocale, string>>` is a real
 * guard, not decoration: adding a third entry to SUPPORTED_LOCALES fails the
 * typecheck here until that locale has a document of its own, rather than
 * silently serving it English.
 */
export const MARKETING_ROUTES = {
  "/": { en: "/", hi: "/hi" },
  "/how-it-works": { en: "/how-it-works", hi: "/hi/how-it-works" },
} as const satisfies Record<string, Record<SupportedLocale, string>>;

export type CanonicalMarketingRoute = keyof typeof MARKETING_ROUTES;

/**
 * Every prerendered marketing document, in every locale. Written out rather
 * than derived so each entry has a literal type (the route tests index by it);
 * public-page-cache.test.ts asserts it against the derivation in both
 * directions, so the two cannot drift.
 */
export const STATIC_PUBLIC_ROUTES = ["/", "/hi", "/how-it-works", "/hi/how-it-works"] as const;

export function isStaticPublicRoute(pathname: string): boolean {
  return (STATIC_PUBLIC_ROUTES as readonly string[]).includes(pathname);
}

/**
 * The landing page in every locale -- the routes an already-logged-in visitor
 * is sent to /dashboard from instead of being shown marketing copy.
 */
export const LANDING_ROUTES = Object.values(MARKETING_ROUTES["/"]) as readonly string[];

export function isLandingRoute(pathname: string): boolean {
  return LANDING_ROUTES.includes(pathname);
}

/**
 * The document `pathname` should be served from for `locale`, or null when
 * the request is already on the right one (including every path that is not a
 * marketing page at all).
 *
 * Middleware turns a non-null answer into a REWRITE, never a redirect: the
 * canonical URLs stay "/" and "/how-it-works" for everyone, and the rewrite
 * target is what the CDN's cache is keyed on -- so each locale's document is
 * cached separately and neither page has to read anything at request time.
 * This is the same shape next-intl's own middleware uses for locale routing
 * with static rendering.
 */
export function localisedMarketingPath(pathname: string, locale: string): string | null {
  const entry = (MARKETING_ROUTES as Record<string, Record<string, string>>)[pathname];
  if (!entry) return null;
  const target = entry[locale] ?? entry[DEFAULT_LOCALE]!;
  return target === pathname ? null : target;
}

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
