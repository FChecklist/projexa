/// <reference types="bun-types" />
// R67 J-01 (audit R-246). Two things are worth failing a build over here:
// the exact header value the audit asked for, and the fact that the rule set
// never widens past the two pages that are genuinely the same document for
// everyone -- a stale-while-revalidate on an authenticated route would let a
// shared cache hand one tenant's HTML to the next visitor.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLIC_PAGE_CACHE_CONTROL,
  STATIC_PUBLIC_ROUTES,
  publicPageHeaderRules,
} from "./public-page-cache";
import { isPublicPagePath } from "./authz/page-access";

describe("publicPageHeaderRules", () => {
  test("emits the exact Cache-Control the audit specified, for both routes", () => {
    expect(PUBLIC_PAGE_CACHE_CONTROL).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    expect(publicPageHeaderRules()).toEqual([
      { source: "/", headers: [{ key: "Cache-Control", value: PUBLIC_PAGE_CACHE_CONTROL }] },
      {
        source: "/how-it-works",
        headers: [{ key: "Cache-Control", value: PUBLIC_PAGE_CACHE_CONTROL }],
      },
    ]);
  });

  test("never caches a route that needs a session", () => {
    for (const route of STATIC_PUBLIC_ROUTES) {
      expect(isPublicPagePath(route)).toBe(true);
    }
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
});
