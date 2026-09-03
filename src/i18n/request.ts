import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
  type SupportedLocale,
} from "./locales";
import { loadMessages } from "./messages";

// PLATFORM-01 Wave 2 (Workstream 5, i18n): PROJEXA is NOT doing URL-prefix
// locale routing for the AUTHENTICATED app ([locale]/dashboard etc.) -- that
// would rewrite every path middleware.ts's page-access check matches against
// and is a much bigger structural change than this wave should attempt. For
// every authenticated route the locale is still resolved purely from the
// NEXT_LOCALE cookie, with no URL involvement at all.
//
// R67 J-01 fix pass (audit R-246): the two PUBLIC marketing routes are the
// exception, and they have to be. They are statically prerendered, and under
// `dynamic = "force-static"` Next hands `cookies()` an EMPTY store (see
// next/dist/server/request/cookies.js -- `if (workStore.forceStatic)` returns
// empty, untracked cookies), so a cookie simply cannot reach them: one cached
// document cannot vary by cookie. The first cut of J-01 accepted that and
// served the marketing site in English to everyone, which silently retired a
// COMPLETE shipped Hindi translation (messages/hi.json carries the whole
// Marketing tree) on the only two pages an unauthenticated prospect ever
// sees. The fix is the thing static rendering does permit: one prerendered
// document PER LOCALE (/ and /hi, /how-it-works and /hi/how-it-works), with
// middleware.ts rewriting to the right one. Those pages therefore pass an
// EXPLICIT locale to getTranslations(), which arrives below as
// `requestLocale` -- so this config honours it before it looks at any cookie.
//
// The locale vocabulary itself now lives in ./locales, which middleware.ts
// imports too instead of keeping a hand-synced copy.
export { DEFAULT_LOCALE, LOCALE_COOKIE, SUPPORTED_LOCALES, resolveLocale };
export type { SupportedLocale };

async function readLocaleCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(LOCALE_COOKIE)?.value;
}

/**
 * The locale for one render, split out of the config below so it can be
 * asserted directly: `next-intl/server` resolves to a stub outside a real
 * Next server render, so calling the config function itself is not testable.
 *
 * `requested` is set when a caller passes a locale explicitly --
 * `getTranslations({locale})`, which is how the per-locale marketing
 * documents are rendered. next-intl caches its config per locale argument, so
 * an explicit locale resolves independently of whatever the ambient request
 * resolved to, and the cookie is never read for it (which matters: on a
 * `force-static` route reading one would be pointless, and on a dynamic route
 * it would be a request-time read a caller did not ask for).
 */
export async function resolveRequestLocale(
  requested: string | undefined,
  readCookie: () => Promise<string | undefined> = readLocaleCookie
): Promise<SupportedLocale> {
  if (isSupportedLocale(requested)) return requested;
  return resolveLocale(await readCookie());
}

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await resolveRequestLocale(await requestLocale);
  return { locale, messages: await loadMessages(locale) };
});
