/// <reference types="bun-types" />
// API_READ_WITHOUT_ROLE_CHECK's regression guard (twin of api-write-policy.test.ts). Regenerates the GET-route set from the real filesystem on
// every run and asserts API_READ_POLICY covers it exactly, in both directions. fs.readdirSync, never a shell glob: this tree has [id] segments.
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { API_READ_POLICY, DEFAULT_READ_TIER, checkApiReadAccess, readNeedsRole, resolveReadTier } from "./api-read-policy";
import { ALL_ORG_ROLES } from "./roles";

const API_ROOT = join(import.meta.dir, "..", "..", "app", "api");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === "route.ts" || e.name === "route.tsx") out.push(full);
  }
  return out;
}

const getRoutes = walk(API_ROOT)
  .map((file) => ({ route: file.slice(API_ROOT.length).split(sep).join("/").replace(/\/route\.tsx?$/, ""), source: readFileSync(file, "utf8") }))
  .filter((r) => !r.route.includes("__tests__") && !r.route.includes(".test."))
  .filter((r) => /export\s+(async\s+)?function\s+GET\b/.test(r.source) || /export\s+const\s+GET\s*=/.test(r.source))
  .map((r) => r.route);

describe("API_READ_POLICY covers the real GET route surface", () => {
  test("there are GET routes to check (the walk is not silently blind)", () => {
    expect(getRoutes.length).toBeGreaterThan(150);
  });
  test("every GET route on disk has an explicit read-policy entry", () => {
    const missing = getRoutes.filter((r) => !(r in API_READ_POLICY));
    expect(missing).toEqual([]);
  });
  test("no policy entry outlives its route", () => {
    const stale = Object.keys(API_READ_POLICY).filter((r) => !getRoutes.includes(r));
    expect(stale).toEqual([]);
  });
});

describe("the finance / HR / commercial leak found on 2026-11-07 is closed", () => {
  const LEAKED = ["/api/employees", "/api/sales-invoices", "/api/vendors", "/api/customers", "/api/accounts", "/api/journal-entries", "/api/trial-balance", "/api/balance-sheet"];
  test("client_viewer and site_engineer are refused on every one of them", () => {
    for (const p of LEAKED) for (const role of ["client_viewer", "site_engineer"]) expect(checkApiReadAccess("GET", p, role).allowed).toBe(false);
  });
  test("owner, admin and pm can still read the commercial lists; payroll and ledger need owner/admin", () => {
    for (const role of ["owner", "admin", "pm"]) {
      expect(checkApiReadAccess("GET", "/api/vendors", role).allowed).toBe(true);
      expect(checkApiReadAccess("GET", "/api/employees", role).allowed).toBe(true);
    }
    expect(checkApiReadAccess("GET", "/api/payroll/runs", "pm").allowed).toBe(false);
    expect(checkApiReadAccess("GET", "/api/accounts", "pm").allowed).toBe(false);
    expect(checkApiReadAccess("GET", "/api/accounts", "admin").allowed).toBe(true);
  });
  test("PROJECT SCOPING (rule B, BOSS 7 Nov): a client viewer cannot list projects or read billing claims, only open a project dashboard by link", () => {
    for (const p of ["/api/projects", "/api/projects/overview", "/api/billing-claims", "/api/billing-claims/c-1"]) {
      expect(checkApiReadAccess("GET", p, "client_viewer").allowed, p).toBe(false);
      for (const role of ["owner", "admin", "pm", "site_engineer", "member"]) {
        expect(checkApiReadAccess("GET", p, role).allowed === (p.includes("billing") ? ["owner", "admin", "pm"].includes(role) : true), p + " as " + role).toBe(true);
      }
    }
    expect(checkApiReadAccess("GET", "/api/dashboard/project/p-1", "client_viewer").allowed).toBe(true);
    expect(checkApiReadAccess("GET", "/api/projects/p-1/category-distribution", "client_viewer").allowed).toBe(true);
  });
  test("a client viewer can still read the project delivery data they are there to see", () => {
    for (const p of ["/api/scope", "/api/work-progress", "/api/dashboard/project/x", "/api/schedule/gantt", "/api/documents", "/api/drawings", "/api/change-orders", "/api/reports/catalog", "/api/notifications"]) {
      expect(checkApiReadAccess("GET", p, "client_viewer").allowed).toBe(true);
    }
  });
  test("a site engineer keeps field data and loses finance data", () => {
    for (const p of ["/api/materials", "/api/labour-roster", "/api/site-diary", "/api/work-progress"]) expect(checkApiReadAccess("GET", p, "site_engineer").allowed).toBe(true);
    expect(checkApiReadAccess("GET", "/api/project-budgets", "site_engineer").allowed).toBe(false);
  });
  test("static routes are not shadowed by a wildcard sibling, and unknown reads fall to the office tier", () => {
    expect(resolveReadTier("/api/scope/cost-visibility")).toBe("ORG_ADMIN");
    expect(resolveReadTier("/api/scope/abc")).toBe("ANY_ROLE");
    expect(resolveReadTier("/api/never-heard-of-it")).toBe(DEFAULT_READ_TIER);
    expect(checkApiReadAccess("GET", "/api/never-heard-of-it", "client_viewer").allowed).toBe(false);
  });
  test("public routes and non-GET methods are not this policy's business; no role means requireAuth decides", () => {
    expect(checkApiReadAccess("GET", "/api/email/sometoken", "client_viewer").allowed).toBe(true);
    expect(checkApiReadAccess("POST", "/api/employees", "client_viewer").allowed).toBe(true);
    expect(checkApiReadAccess("GET", "/api/employees", null).allowed).toBe(true);
  });
  test("the role lookup is only paid for restricted tiers", () => {
    expect(readNeedsRole("GET", "/api/scope")).toBe(false);
    expect(readNeedsRole("GET", "/api/employees")).toBe(true);
    expect(readNeedsRole("POST", "/api/employees")).toBe(false);
  });
  test("every defined role gets a decision on every tier (no role is left out)", () => {
    for (const role of ALL_ORG_ROLES) expect(typeof checkApiReadAccess("GET", "/api/accounts", role).allowed).toBe("boolean");
  });
});
