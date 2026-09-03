/// <reference types="bun-types" />
// R67 J-01 fix pass (audit R-246). These four values used to be declared
// twice -- here and, copy-pasted, in src/middleware.ts -- with both copies
// carrying a comment asking whoever adds a third locale to remember the other
// one. They are now one leaf module that middleware.ts imports, and this
// pins the behaviour both callers depend on.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeFromAcceptLanguage,
  resolveLocale,
} from "./locales";

describe("the locale vocabulary", () => {
  test("is the two locales this app actually ships message files for", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["en", "hi"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  test("the cookie name matches the one middleware.ts writes", () => {
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
  });
});

describe("resolveLocale", () => {
  test("a supported cookie value wins", () => {
    expect(resolveLocale("hi")).toBe("hi");
    expect(resolveLocale("en")).toBe("en");
  });

  test("no cookie -- the force-static case -- resolves to the default locale", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  test("an unsupported or junk cookie value falls back rather than throwing", () => {
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("en-US")).toBe(DEFAULT_LOCALE);
  });
});

describe("isSupportedLocale", () => {
  test("narrows only the real locales", () => {
    expect(isSupportedLocale("hi")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });
});

describe("localeFromAcceptLanguage", () => {
  test("reads the first tag's primary subtag", () => {
    expect(localeFromAcceptLanguage("hi-IN,hi;q=0.9,en;q=0.8")).toBe("hi");
    expect(localeFromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("HI")).toBe("hi");
  });

  test("returns null rather than a locale this app has no messages for", () => {
    // The caller decides the fallback; this must not quietly answer "en" for
    // a German browser, or the Hindi rewrite would be unreachable to reason
    // about.
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
  });
});
