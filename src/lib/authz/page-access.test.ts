/// <reference types="bun-types" />
// R48_PAGE_AUTH_GATE_COVERS_HALF_THE_NAV_01's regression guard.
//
// The recorded fault is not just "23 pages were ungated" -- it is that the
// mechanism was hand-maintained and had already drifted twice in ways nobody
// noticed ("/ai-copilot" for a route that ships as "/copilot"; "/manpower" for
// a route that does not exist). Listing the missing prefixes would leave that
// property intact. This test removes it: the src/app tree is walked on every
// run and the rule asserted route by route.
//
// THE RULE, and it is structural rather than a list: every page under
// src/app/(app)/ is behind the gate; every page outside it is public. The
// route group is the app shell -- (app)/layout.tsx renders the authenticated
// chrome -- so "is it in (app)?" is the same question as "does it need a
// session?", and unlike a prefix array it cannot fall out of sync with where
// the file actually lives.
import { describe, test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import {
  requiresAuthenticatedPage,
  isPublicPagePath,
  isApiPath,
  isAssetPath,
  PUBLIC_PAGE_PATHS_FOR_TEST,
} from "./page-access";

const APP_ROOT = join(import.meta.dir, "..", "..", "app");

function walkPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api") continue;
      walkPageFiles(full, out);
    } else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

type Page = { url: string; inAppShell: boolean };

// A concrete, requestable URL for a route pattern: dynamic segments get a
// plausible value, because that is what the middleware actually sees.
function concreteUrl(route: string): string {
  return route.replace(/\[[^\]]+\]/g, "sample-token-123");
}

const pages: Page[] = walkPageFiles(APP_ROOT).map((file) => {
  const rel = file.slice(APP_ROOT.length).split(sep).join("/");
  const inAppShell = rel.startsWith("/(app)/");
  const route = rel.replace(/\/page\.tsx$/, "").replace(/\/\([^/]+\)/g, "");
  return { url: route === "" ? "/" : route, inAppShell };
});

describe("the page gate covers the whole app shell", () => {
  test("the walk found the real tree, so an empty walk can never pass silently", () => {
    expect(pages.length).toBeGreaterThan(50);
    expect(pages.filter((p) => p.inAppShell).length).toBeGreaterThan(40);
  });

  test("EVERY page under src/app/(app)/ requires authentication", () => {
    const ungated = pages
      .filter((p) => p.inAppShell)
      .filter((p) => !requiresAuthenticatedPage(concreteUrl(p.url)))
      .map((p) => p.url)
      .sort();
    expect(ungated).toEqual([]);
  });

  test("EVERY page outside the app shell is public", () => {
    const overGated = pages
      .filter((p) => !p.inAppShell)
      .filter((p) => requiresAuthenticatedPage(concreteUrl(p.url)))
      .map((p) => p.url)
      .sort();
    expect(overGated).toEqual([]);
  });

  test("the public exact-path list names only routes that actually exist", () => {
    const onDisk = new Set(pages.map((p) => p.url));
    const phantom = [...PUBLIC_PAGE_PATHS_FOR_TEST].filter((p) => !onDisk.has(p)).sort();
    // This is the "/manpower" class of defect -- a gate entry for a route that
    // was never there -- caught in the opposite direction.
    expect(phantom).toEqual([]);
  });

  test("the specific routes the old allow-list lost are now gated", () => {
    // "/ai-copilot" was in PROTECTED_PREFIXES; the route ships as "/copilot".
    for (const route of [
      "/copilot",
      "/accounting",
      "/customers",
      "/employees",
      "/grc",
      "/hr",
      "/inventory",
      "/invoices",
      "/knowledge-base",
      "/meetings",
      "/moms",
      "/payroll",
      "/permits",
      "/procurement",
      "/purchase-orders",
      "/quotations",
      "/recruitment",
      "/sales",
      "/sales-orders",
      "/wiki",
    ]) {
      expect(requiresAuthenticatedPage(route)).toBe(true);
    }
  });
});

describe("the clause that must never be dropped", () => {
  test("no /api path is ever treated as a page", () => {
    // Without this, every API 401 JSON becomes a 307 to an HTML login page.
    expect(requiresAuthenticatedPage("/api/payroll/runs")).toBe(false);
    expect(requiresAuthenticatedPage("/api")).toBe(false);
    expect(isApiPath("/api/anything/at/all")).toBe(true);
    expect(isApiPath("/apidocs")).toBe(false);
  });

  test("static files are not redirected to /login", () => {
    for (const asset of ["/sw.js", "/manifest.webmanifest", "/robots.txt", "/logo-mark.svg", "/icons/icon-192.png"]) {
      expect(isAssetPath(asset)).toBe(true);
      expect(requiresAuthenticatedPage(asset)).toBe(false);
    }
  });

  test("the auth callback and token-scoped public routes stay reachable logged out", () => {
    for (const route of ["/auth/callback", "/invite/abc123", "/share/report/xyz789", "/login", "/signup", "/", "/how-it-works"]) {
      expect(isPublicPagePath(route)).toBe(true);
      expect(requiresAuthenticatedPage(route)).toBe(false);
    }
  });

  test("an unknown page path fails CLOSED", () => {
    // The whole point of the inversion: a route nobody remembered to list is
    // gated, not open.
    expect(requiresAuthenticatedPage("/some-module-shipped-next-week")).toBe(true);
  });
});
