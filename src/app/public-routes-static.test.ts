/// <reference types="bun-types" />
// R67 J-01 (audit R-246). "/" shipped a warm TTFB of 1375 ms and a warm FCP
// (1672 ms) SLOWER than its cold one, because it was server-rendered on
// every request; /how-it-works and /login, which are not, painted in 232 ms
// and 120 ms. This pins the three things that make the two marketing routes
// prerenderable, each of which is a single line away from being undone:
//
//   1. both declare `dynamic = "force-static"` + `revalidate = 3600`;
//   2. neither page module reads request state (a cookies()/headers() call,
//      or a Supabase server client, anywhere in the page file puts the route
//      straight back to render-per-request);
//   3. the logged-in redirect that used to force (1) and (2) open still
//      exists -- in middleware.ts, where it costs nothing.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATIC_PUBLIC_ROUTES } from "@/lib/public-page-cache";
import { isPublicPagePath, requiresAuthenticatedPage } from "@/lib/authz/page-access";

const APP_DIR = import.meta.dir;

const ROUTE_FILES: Record<(typeof STATIC_PUBLIC_ROUTES)[number], string> = {
  "/": join(APP_DIR, "page.tsx"),
  "/how-it-works": join(APP_DIR, "how-it-works", "page.tsx"),
};

// Imported once at module scope rather than inside each test: pulling in a
// page module drags the whole marketing component tree (and next-intl)
// through the transpiler, which takes longer than bun's default 5 s
// per-test timeout on a cold run.
type RouteSegmentConfig = { dynamic?: unknown; revalidate?: unknown };
const ROUTE_MODULES: Record<string, RouteSegmentConfig> = {
  "/": (await import(ROUTE_FILES["/"])) as RouteSegmentConfig,
  "/how-it-works": (await import(ROUTE_FILES["/how-it-works"])) as RouteSegmentConfig,
};

describe("the statically prerendered public routes", () => {
  test("STATIC_PUBLIC_ROUTES names exactly the two marketing pages", () => {
    expect([...STATIC_PUBLIC_ROUTES]).toEqual(["/", "/how-it-works"]);
  });

  for (const route of STATIC_PUBLIC_ROUTES) {
    test(`${route} declares force-static and an hourly revalidate`, () => {
      const mod = ROUTE_MODULES[route]!;
      expect(mod.dynamic).toBe("force-static");
      expect(mod.revalidate).toBe(3600);
    });

    test(`${route} reads nothing from the request`, () => {
      const source = readFileSync(ROUTE_FILES[route], "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
      expect(source).not.toContain("cookies(");
      expect(source).not.toContain("headers(");
      expect(source).not.toContain("createClient");
      expect(source).not.toContain("getClaims");
      expect(source).not.toContain("searchParams");
    });

    test(`${route} stays reachable without a session`, () => {
      expect(isPublicPagePath(route)).toBe(true);
      expect(requiresAuthenticatedPage(route)).toBe(false);
    });
  }

  test("middleware still sends a logged-in visitor from / to /dashboard", () => {
    // The redirect moved out of src/app/page.tsx; if it did not land here the
    // behaviour is simply gone, and nothing else in the app would notice.
    const middleware = readFileSync(join(APP_DIR, "..", "middleware.ts"), "utf8");
    expect(middleware).toContain('userId && pathname === "/"');
    expect(middleware).toContain('url.pathname = "/dashboard"');
  });
});
