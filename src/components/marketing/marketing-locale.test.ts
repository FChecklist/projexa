/// <reference types="bun-types" />
// R67 J-01 fix pass (audit R-246). The drift guard for per-locale marketing
// documents.
//
// THE FAILURE THIS PREVENTS is silent and looks fine in review: a marketing
// Server Component that calls `getTranslations("Marketing.x")` instead of
// `getTranslations({locale, namespace: "Marketing.x"})` renders in the
// AMBIENT locale. On a statically prerendered route the ambient locale is
// always the default one (under `force-static` Next hands `cookies()` an
// empty store), and src/app/layout.tsx has already resolved and cached it
// before any page runs -- so `setRequestLocale()` cannot fix it afterwards.
// One such call would put an English section in the middle of the Hindi
// document, with nothing in the source suggesting it.
//
// Same pattern as page-access.test.ts / nav-routes.test.ts in this repo: the
// rule is regenerated from the real files on every run rather than trusted.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MARKETING_ROUTES } from "@/lib/public-page-cache";

const MARKETING_DIR = import.meta.dir;
const APP_DIR = join(MARKETING_DIR, "..", "..", "app");

function componentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      componentFiles(full, out);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
}

const TRANSLATING_FILES = componentFiles(MARKETING_DIR)
  .map((file) => ({ file, source: stripComments(readFileSync(file, "utf8")) }))
  .filter(({ source }) => source.includes("getTranslations("));

describe("every marketing component translates in an EXPLICIT locale", () => {
  test("the walk found the real component tree", () => {
    // An empty walk must never pass silently -- 14 of these files call
    // getTranslations today.
    expect(TRANSLATING_FILES.length).toBeGreaterThan(10);
  });

  test("no component resolves the ambient request locale", () => {
    const ambient = TRANSLATING_FILES.filter(({ source }) =>
      /getTranslations\(\s*["'`]/.test(source)
    ).map(({ file }) => file.slice(MARKETING_DIR.length));
    expect(ambient).toEqual([]);
  });

  test("every call passes the locale it was given as a prop", () => {
    const missing: string[] = [];
    for (const { file, source } of TRANSLATING_FILES) {
      const calls = [...source.matchAll(/getTranslations\(\{([^}]*)\}/g)];
      const name = file.slice(MARKETING_DIR.length);
      if (calls.length === 0) missing.push(`${name}: no object-form call`);
      for (const call of calls) {
        if (!/\blocale\b/.test(call[1]!)) missing.push(`${name}: ${call[0]}`);
      }
      // ...and the locale is a prop, not a constant baked into the component
      // (the pages own that choice; a component must render either language).
      if (!/locale[?]?\s*[,:}]/.test(source)) missing.push(`${name}: takes no locale prop`);
    }
    expect(missing).toEqual([]);
  });
});

describe("the page routes pick the locale, one document each", () => {
  const ROUTE_FILES: Record<string, string> = {
    "/": join(APP_DIR, "page.tsx"),
    "/hi": join(APP_DIR, "hi", "page.tsx"),
    "/how-it-works": join(APP_DIR, "how-it-works", "page.tsx"),
    "/hi/how-it-works": join(APP_DIR, "hi", "how-it-works", "page.tsx"),
  };

  test("MARKETING_ROUTES names exactly these four documents", () => {
    const documents = Object.values(MARKETING_ROUTES).flatMap((byLocale) => Object.values(byLocale));
    expect([...documents].sort()).toEqual(Object.keys(ROUTE_FILES).sort());
  });

  for (const [route, file] of Object.entries(ROUTE_FILES)) {
    const locale = route.startsWith("/hi") ? "hi" : "en";
    test(`${route} renders in "${locale}"`, () => {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source).toContain(`locale="${locale}"`);
      expect(source).not.toContain(`locale="${locale === "hi" ? "en" : "hi"}"`);
    });
  }

  for (const route of ["/hi", "/hi/how-it-works"]) {
    test(`${route} also overrides the CLIENT provider, or its header would be English`, () => {
      // MarketingHeader and ContactForm are "use client" and read
      // <NextIntlClientProvider>, which the root layout mounts in the ambient
      // (default) locale -- so a Hindi document needs the nested provider.
      const source = stripComments(readFileSync(ROUTE_FILES[route]!, "utf8"));
      expect(source).toContain("MarketingLocaleProvider");
    });
  }
});
