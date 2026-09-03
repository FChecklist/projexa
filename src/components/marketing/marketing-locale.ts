import type { SupportedLocale } from "@/i18n/locales";

// R67 J-01 fix pass (audit R-246). Every marketing Server Component takes the
// locale as an EXPLICIT prop and passes it to
// `getTranslations({locale, namespace})`, rather than resolving the ambient
// request locale with `getTranslations(namespace)`.
//
// WHY, precisely -- this is not a style preference. The marketing pages are
// prerendered once per locale (/ and /hi, /how-it-works and
// /hi/how-it-works). next-intl resolves and CACHES its config per locale
// argument for the duration of a render, and src/app/layout.tsx -- which
// renders before any page -- already asks for the ambient one
// (getLocale()/getMessages()). By the time the /hi page's children run, the
// ambient entry is therefore already resolved to the default locale and
// `setRequestLocale()` cannot change it. An explicit locale is a different
// cache key, so it resolves independently and correctly. Without it the
// Hindi document would render in English while looking, in the source, as
// though it were translated.
//
// marketing-locale.test.ts regenerates this rule from the filesystem: a
// marketing component that calls getTranslations() without an explicit locale
// fails the suite.
export type MarketingLocaleProps = {
  locale: SupportedLocale;
};
