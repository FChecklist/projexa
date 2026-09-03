import type { SupportedLocale } from "./locales";

export type MessageCatalogue = Record<string, unknown>;

/**
 * The message catalogue for one locale.
 *
 * Split out of src/i18n/request.ts (where it was an inline dynamic import
 * inside getRequestConfig) because two other server-side callers need it now:
 * MarketingLocaleProvider, which hands the client half of a per-locale
 * marketing document its messages, and the tests that assert the Hindi
 * document really carries Hindi strings.
 *
 * Deliberately still a dynamic import rather than two static ones: a static
 * `import hi from "../../messages/hi.json"` would pull BOTH catalogues into
 * every server bundle that touches this module, and hi.json alone is 39 KB.
 */
export async function loadMessages(locale: SupportedLocale): Promise<MessageCatalogue> {
  return (await import(`../../messages/${locale}.json`)).default as MessageCatalogue;
}
