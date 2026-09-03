import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// PLATFORM-01 Wave 2 (Workstream 5, i18n): PROJEXA is NOT doing URL-prefix
// locale routing ([locale]/... segments) -- that would be a much bigger
// structural change than this wave should attempt, and it would conflict
// with middleware.ts's existing path-based auth matcher (PROTECTED_PREFIXES
// checks request.nextUrl.pathname directly, e.g. "/dashboard"; a locale
// prefix would break every one of those checks). Locale is resolved purely
// from a cookie (see middleware.ts, which sets NEXT_LOCALE alongside its
// auth logic on first visit) with no URL involvement at all.
//
// SUPPORTED_LOCALES / DEFAULT_LOCALE are intentionally duplicated in
// middleware.ts rather than imported from here -- middleware.ts runs in the
// Edge runtime and this file is loaded per-request-render via next-intl's
// server plugin; keeping the two lists in sync manually is simpler than
// sharing a module across those two boundaries for a 2-entry list. If a
// third locale is added, update both places.
export const SUPPORTED_LOCALES = ["en", "hi"] as const;
export const DEFAULT_LOCALE = "en" as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * The whole locale decision, as a pure function of the cookie value, so it
 * can be asserted without a request.
 *
 * R67 J-01 (audit R-246): this is also where the statically prerendered
 * public pages land. src/app/page.tsx and src/app/how-it-works/page.tsx
 * declare `dynamic = "force-static"`, under which Next's `cookies()` returns
 * an EMPTY cookie store instead of throwing a DynamicServerError (see
 * next/dist/server/request/cookies.js -- `if (workStore.forceStatic)`
 * returns empty, untracked cookies). So on those two routes this function is
 * called with `undefined` and returns DEFAULT_LOCALE, by design: one cached
 * HTML document cannot vary by cookie. Every authenticated route is
 * unaffected and still follows NEXT_LOCALE.
 */
export function resolveLocale(cookieValue: string | undefined): SupportedLocale {
  if (cookieValue && (SUPPORTED_LOCALES as readonly string[]).includes(cookieValue)) {
    return cookieValue as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
