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

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: SupportedLocale =
    cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)
      ? (cookieLocale as SupportedLocale)
      : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
