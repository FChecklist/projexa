/// <reference types="bun-types" />
// R67 J-01 (audit R-246). The locale decision is a pure function so the
// things that matter about it can be asserted without a request:
//   1. a valid NEXT_LOCALE cookie still wins (the authenticated app must not
//      lose Hindi because the marketing pages went static), and
//   2. an ABSENT cookie resolves to the default -- which is exactly the call
//      shape the statically prerendered public routes make, because under
//      `dynamic = "force-static"` Next hands `cookies()` an empty store.
//
// R67 J-01 FIX PASS adds the third: (3) an EXPLICITLY requested locale beats
// both, without touching cookies() at all. That is the mechanism the two
// per-locale marketing documents are rendered through -- src/app/hi/page.tsx
// and its sections call `getTranslations({locale: "hi", ...})`, next-intl
// passes that through to `requestLocale` here, and if this file ignored it
// (as it did before the fix) the Hindi route would render in English while
// looking translated in the source. The assertions below call the real
// exported config function; `getRequestConfig` is the identity function, so
// this is the same code path Next runs.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  resolveLocale,
  resolveRequestLocale,
} from "./request";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";

/** A cookie reader that fails the test if the resolution ever consults it. */
function noCookieRead(): Promise<string | undefined> {
  throw new Error("the cookie must not be read when an explicit locale was requested");
}

describe("resolveLocale", () => {
  test("a supported cookie value wins", () => {
    expect(resolveLocale("hi")).toBe("hi");
    expect(resolveLocale("en")).toBe("en");
  });

  test("no cookie -- the force-static case -- resolves to the default locale", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  test("an unsupported or junk cookie value falls back rather than throwing", () => {
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("en-US")).toBe(DEFAULT_LOCALE);
  });

  test("the cookie name matches the one middleware.ts writes", () => {
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
  });

  test("every supported locale has a real message file behind it", () => {
    // Guards loadMessages()'s dynamic `import(../../messages/${locale}.json)`,
    // which would 500 the whole app for a locale whose file was never added.
    const files: Record<string, unknown> = { en, hi };
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(files[locale] as object).length).toBeGreaterThan(0);
    }
  });
});

describe("resolveRequestLocale", () => {
  test("an explicitly requested locale wins, and no cookie is read for it", async () => {
    expect(await resolveRequestLocale("hi", noCookieRead)).toBe("hi");
    expect(await resolveRequestLocale("en", noCookieRead)).toBe("en");
  });

  test("with no explicit locale it falls back to the NEXT_LOCALE cookie", async () => {
    expect(await resolveRequestLocale(undefined, async () => "hi")).toBe("hi");
    expect(await resolveRequestLocale(undefined, async () => undefined)).toBe(DEFAULT_LOCALE);
  });

  test("an unsupported requested locale is never served as-is", async () => {
    // It must fall through rather than trying to load messages/fr.json, which
    // does not exist -- a 500 on every page instead of a missing translation.
    expect(await resolveRequestLocale("fr", async () => undefined)).toBe(DEFAULT_LOCALE);
    expect(await resolveRequestLocale("fr", async () => "hi")).toBe("hi");
  });

  test("the two locales it can return are the two catalogues that exist", () => {
    const files: Record<string, unknown> = { en, hi };
    for (const locale of SUPPORTED_LOCALES) {
      expect(files[locale]).toBeDefined();
    }
  });
});
