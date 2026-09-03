/// <reference types="bun-types" />
// R67 J-01 (audit R-246). The locale decision is now a pure function so the
// two things that matter about it can be asserted without a request:
//   1. a valid NEXT_LOCALE cookie still wins (the authenticated app must not
//      lose Hindi because the marketing pages went static), and
//   2. an ABSENT cookie resolves to the default -- which is exactly the call
//      shape the statically prerendered public routes make, because under
//      `dynamic = "force-static"` Next hands `cookies()` an empty store.
import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, LOCALE_COOKIE, SUPPORTED_LOCALES, resolveLocale } from "./request";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";

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
    // Guards the dynamic `import(\`../../messages/${locale}.json\`)` in
    // getRequestConfig, which would 500 the whole app for a locale whose
    // file was never added.
    const files: Record<string, unknown> = { en, hi };
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(files[locale] as object).length).toBeGreaterThan(0);
    }
  });
});
