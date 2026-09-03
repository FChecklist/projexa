/// <reference types="bun-types" />
// R67 J-01 (audit R-246). Things worth failing a build over here: the exact
// header value the audit asked for, the fact that the rule set never widens
// past the pages that are genuinely the same document for everyone in a
// locale (a stale-while-revalidate on an authenticated route would let a
// shared cache hand one tenant's HTML to the next visitor), and -- added by
// the fix pass -- the locale map those documents are addressed by.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LANDING_ROUTES,
  MARKETING_ROUTES,
  PUBLIC_PAGE_CACHE_CONTROL,
  STATIC_PUBLIC_ROUTES,
  isLandingRoute,
  isStaticPublicRoute,
  localisedMarketingPath,
  publicPageHeaderRules,
} from "./public-page-cache";
import { isPublicPagePath } from "./authz/page-access";
import { SUPPORTED_LOCALES } from "../i18n/locales";

describe("MARKETING_ROUTES", () => {
  test("gives every supported locale a document for every marketing page", () => {
    for (const [canonical, byLocale] of Object.entries(MARKETING_ROUTES)) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(`${canonical}/${locale}: ${(byLocale as Record<string, string>)[locale]}`).not.toContain(
          "undefined"
        );
      }
    }
  });

  test("STATIC_PUBLIC_ROUTES is exactly those documents, in both directions", () => {
    const derived = Object.values(MARKETING_ROUTES).flatMap((byLocale) => Object.values(byLocale));
    expect([...STATIC_PUBLIC_ROUTES].sort()).toEqual([...derived].sort());
    expect(new Set(STATIC_PUBLIC_ROUTES).size).toBe(STATIC_PUBLIC_ROUTES.length);
  });
});

describe("localisedMarketingPath", () => {
  test("sends a Hindi visitor to the Hindi document", () => {
    expect(localisedMarketingPath("/", "hi")).toBe("/hi");
    expect(localisedMarketingPath("/how-it-works", "hi")).toBe("/hi/how-it-works");
  });

  test("returns null when the request is already on the right document", () => {
    // null means "no rewrite", which is what keeps the English path free of
    // an unnecessary middleware rewrite on every single request.
    expect(localisedMarketingPath("/", "en")).toBeNull();
    expect(localisedMarketingPath("/how-it-works", "en")).toBeNull();
    expect(localisedMarketingPath("/hi", "hi")).toBeNull();
    expect(localisedMarketingPath("/hi/how-it-works", "hi")).toBeNull();
  });

  test("never rewrites a route that is not a marketing page", () => {
    for (const path of ["/login", "/dashboard", "/api/rfis", "/hindi", "/hi-there"]) {
      expect(`${path}: ${localisedMarketingPath(path, "hi")}`).toBe(`${path}: null`);
    }
  });

  test("an unknown locale falls back to the default document rather than 404ing", () => {
    expect(localisedMarketingPath("/", "fr")).toBeNull();
    expect(localisedMarketingPath("/how-it-works", "fr")).toBeNull();
  });

  test("only a canonical URL is ever rewritten, so a rewrite cannot chain", () => {
    // The map is keyed on the canonical (default-locale) paths, so a request
    // that already names a locale document -- including the rewritten one
    // Next re-enters middleware with -- is left exactly where it is.
    for (const locale of ["en", "hi", "fr"]) {
      expect(`${locale}: ${localisedMarketingPath("/hi", locale)}`).toBe(`${locale}: null`);
      expect(`${locale}: ${localisedMarketingPath("/hi/how-it-works", locale)}`).toBe(`${locale}: null`);
    }
  });
});

describe("the landing routes", () => {
  test("are the landing page in every locale -- the ones a logged-in visitor skips", () => {
    expect([...LANDING_ROUTES].sort()).toEqual(["/", "/hi"]);
    expect(isLandingRoute("/")).toBe(true);
    expect(isLandingRoute("/hi")).toBe(true);
    expect(isLandingRoute("/how-it-works")).toBe(false);
    expect(isLandingRoute("/hi/how-it-works")).toBe(false);
  });
});

describe("publicPageHeaderRules", () => {
  test("emits the exact Cache-Control the audit specified, for every document", () => {
    expect(PUBLIC_PAGE_CACHE_CONTROL).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    expect(publicPageHeaderRules()).toEqual(
      [...STATIC_PUBLIC_ROUTES].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: PUBLIC_PAGE_CACHE_CONTROL }],
      }))
    );
  });

  test("never caches a route that needs a session", () => {
    for (const route of STATIC_PUBLIC_ROUTES) {
      expect(isPublicPagePath(route)).toBe(true);
      expect(isStaticPublicRoute(route)).toBe(true);
    }
    expect(isStaticPublicRoute("/dashboard")).toBe(false);
  });

  test("uses no wildcard, so a new route cannot inherit the header by accident", () => {
    for (const { source } of publicPageHeaderRules()) {
      expect(source).not.toContain(":");
      expect(source).not.toContain("*");
    }
  });

  test("next.config.ts actually returns these rules", () => {
    // The module is only useful if the config uses it; importing next.config
    // here would drag in next-intl's plugin loader, so this reads it.
    const config = readFileSync(join(import.meta.dir, "..", "..", "next.config.ts"), "utf8");
    expect(config).toContain("publicPageHeaderRules");
    expect(config).toContain("async headers()");
  });

  test("middleware attaches no Set-Cookie to any of them", () => {
    // The behavioural version of this lives in src/middleware.test.ts, which
    // calls the real function. This is the structural half: the exception is
    // driven by isStaticPublicRoute(), so the header rules and the cookie
    // skip cannot list different routes.
    const middleware = readFileSync(join(import.meta.dir, "..", "middleware.ts"), "utf8");
    expect(middleware).toContain("if (isStaticPublicRoute(pathname)) return supabaseResponse;");
  });
});
