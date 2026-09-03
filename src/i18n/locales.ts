// The locale vocabulary, as a leaf module with NO imports.
//
// WHY IT EXISTS: these four values used to be declared twice -- once in
// src/i18n/request.ts and once, copy-pasted, in src/middleware.ts, with a
// comment in each saying "kept in sync manually ... if a third locale is
// added, update both places". middleware.ts runs in the Edge runtime, which
// is why the copy was made: request.ts imports next-intl/server and
// next/headers, neither of which belongs in a middleware bundle. Splitting
// the vocabulary out removes the duplication without dragging either of those
// into the Edge bundle -- this file imports nothing at all, so it is safe
// from middleware, from a Server Component, and from bun test alike.
//
// R67 J-01 fix pass: src/lib/public-page-cache.ts also needs the locale type
// now that the two public marketing pages are prerendered once PER LOCALE,
// and it is imported by middleware.ts -- which is what made a shared leaf
// module necessary rather than merely tidy.

export const SUPPORTED_LOCALES = ["en", "hi"] as const;
export const DEFAULT_LOCALE = "en" as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The whole locale decision, as a pure function of a cookie value, so it can
 * be asserted without a request.
 */
export function resolveLocale(cookieValue: string | undefined): SupportedLocale {
  return isSupportedLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

/**
 * The first tag's primary subtag of an Accept-Language header, when it names
 * a locale this app has messages for. No q-value weighting: a first-visit
 * default does not need a full negotiation algorithm, and this is only ever
 * a fallback for "no NEXT_LOCALE cookie yet".
 */
export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  const preferred = header?.split(",")[0]?.split("-")[0]?.trim().toLowerCase();
  return isSupportedLocale(preferred) ? preferred : null;
}
