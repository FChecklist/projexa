/// <reference types="bun-types" />
// R-81 ("NO visible pill may be unwired"). Two jobs:
//
//  1. Keep SHIPPED_ROUTES honest. It is a checked-in list (a client component
//     cannot read the filesystem), so this test regenerates it from the real
//     src/app/**/page.tsx files and asserts exact equality in BOTH directions
//     -- a page added without being listed, or a page deleted and left listed,
//     fails here instead of shipping a dead pill to a demo.
//
//  2. Assert the sidebar itself is clean: every href AppSidebar declares must
//     resolve to a real page. This is the regression guard that makes R-81
//     stay closed rather than being true only on the day it was measured.
//
// The route walk below deliberately uses fs.readdirSync rather than any shell
// glob: src/app contains [id]/[token] dynamic segments, and bracket paths are
// wildcards in PowerShell (silently matching nothing) -- a known way to get a
// confidently wrong file count in this project.
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { SHIPPED_ROUTES, isShippedRoute, filterShippedNav } from "./nav-routes";

const APP_ROOT = join(import.meta.dir, "..", "app");
const SIDEBAR_PATH = join(import.meta.dir, "..", "components", "AppSidebar.tsx");

function walkPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkPageFiles(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function routesOnDisk(): string[] {
  return walkPageFiles(APP_ROOT)
    .map((file) => {
      const rel = file.slice(APP_ROOT.length).split(sep).join("/");
      // "/(app)/rfis/page.tsx" -> "/rfis": strip the file, then the route
      // groups, which are organisational only and never appear in a URL.
      const route = rel.replace(/\/page\.tsx$/, "").replace(/\/\([^/]+\)/g, "");
      return route === "" ? "/" : route;
    })
    .sort();
}

function sidebarHrefs(): string[] {
  const source = readFileSync(SIDEBAR_PATH, "utf8");
  return [...source.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("SHIPPED_ROUTES", () => {
  test("matches the real src/app/**/page.tsx routes exactly, in both directions", () => {
    expect([...SHIPPED_ROUTES].sort()).toEqual(routesOnDisk());
  });

  test("lists no route twice", () => {
    expect(new Set(SHIPPED_ROUTES).size).toBe(SHIPPED_ROUTES.length);
  });
});

describe("isShippedRoute", () => {
  test("accepts a static route that exists", () => {
    expect(isShippedRoute("/rfis")).toBe(true);
  });

  test("ignores the ?projectId= suffix the sidebar appends to every project-scoped link", () => {
    expect(isShippedRoute("/rfis?projectId=abc123")).toBe(true);
  });

  test("matches a dynamic route by pattern rather than treating it as a dead end", () => {
    expect(isShippedRoute("/permits/some-real-id")).toBe(true);
    expect(isShippedRoute("/floor-plans/plan-7/walkthrough")).toBe(true);
  });

  test("rejects a route with no page.tsx behind it", () => {
    expect(isShippedRoute("/gst-reconciliation")).toBe(false);
    expect(isShippedRoute("/permits/some-id/extra-segment")).toBe(false);
  });
});

describe("filterShippedNav", () => {
  test("drops unwired items and keeps wired ones", () => {
    const sections = [
      { titleKey: "s1", items: [{ href: "/rfis" }, { href: "/not-a-real-page" }, { href: "/scope" }] },
    ];
    expect(filterShippedNav(sections)[0].items).toEqual([{ href: "/rfis" }, { href: "/scope" }]);
  });

  test("drops a section left with no items, rather than rendering an empty header", () => {
    const sections = [
      { titleKey: "dead", items: [{ href: "/nope" }] },
      { titleKey: "live", items: [{ href: "/scope" }] },
    ];
    expect(filterShippedNav(sections).map((s) => s.titleKey)).toEqual(["live"]);
  });

  test("preserves the other fields on a section it keeps", () => {
    const sections = [{ titleKey: "keep", extra: 42, items: [{ href: "/scope" }] }];
    expect(filterShippedNav(sections)[0].extra).toBe(42);
  });
});

describe("AppSidebar's declared nav entries (R-81 regression guard)", () => {
  test("every sidebar href resolves to a real page", () => {
    const unwired = sidebarHrefs().filter((href) => !isShippedRoute(href));
    expect(unwired).toEqual([]);
  });

  test("the sidebar declares at least one entry, so an empty nav can never pass this suite silently", () => {
    expect(sidebarHrefs().length).toBeGreaterThan(0);
  });
});
