/// <reference types="bun-types" />
// R48_API_WRITES_WITHOUT_ROLE_CHECK_01's regression guard.
//
// The fault this closes was not "somebody forgot a check once" -- it was that
// nothing could TELL you a check was missing. 146 of 159 mutating routes had no
// role gate and the only way to learn that was to read 216 files by hand. This
// test regenerates the mutating-route set from the real filesystem on every run
// and asserts, in BOTH directions, that API_WRITE_POLICY covers it exactly: a
// route added without a policy entry fails here, and a policy entry left behind
// after its route is deleted fails here too.
//
// The walk uses fs.readdirSync rather than any shell glob on purpose. This tree
// contains [id]/[placementId] dynamic segments, and a PowerShell path with
// unescaped brackets is a wildcard that silently matches nothing -- a known way
// to get a confidently wrong count in this project (the fault row itself had to
// be corrected once for exactly that reason).
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import {
  API_WRITE_POLICY,
  DEFAULT_WRITE_TIER,
  checkApiWriteAccess,
  resolveWriteTier,
} from "./api-write-policy";
import { ROLE_GROUPS, ALL_ORG_ROLES } from "./roles";

const API_ROOT = join(import.meta.dir, "..", "..", "app", "api");
const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"] as const;

type RouteFile = { route: string; source: string; verbs: string[] };

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRouteFiles(full, out);
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full);
  }
  return out;
}

function routeFilesOnDisk(): RouteFile[] {
  return walkRouteFiles(API_ROOT)
    .map((file) => {
      const rel = file.slice(API_ROOT.length).split(sep).join("/");
      const route = rel.replace(/\/route\.tsx?$/, "");
      const source = readFileSync(file, "utf8");
      // R67 F-28 STRENGTHENS this detector rather than working around it.
      // Route handlers are now wrapped for Server-Timing, so a mutating route
      // is exported as `export const POST = withTiming("POST", async function
      // POST(...))` as well as the original `export async function POST(...)`.
      // A detector that only knew the first shape would have reported ZERO
      // mutating routes -- i.e. this guard would have gone silently blind
      // exactly when a new ungated write route was added. It now recognises
      // BOTH shapes, so it fails if either kind is left out of the policy.
      const verbs = MUTATING_VERBS.filter(
        (v) =>
          new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b`).test(source) ||
          new RegExp(`export\\s+const\\s+${v}\\s*=`).test(source)
      );
      return { route, source, verbs: [...verbs] };
    })
    .filter((r) => !r.route.includes("__tests__") && !r.route.includes(".test."));
}

const onDisk = routeFilesOnDisk();
const mutatingRoutes = onDisk.filter((r) => r.verbs.length > 0).map((r) => r.route);

describe("API_WRITE_POLICY covers the real mutating route surface", () => {
  test("every mutating route on disk has an explicit policy entry", () => {
    const missing = mutatingRoutes.filter((r) => !(r in API_WRITE_POLICY)).sort();
    expect(missing).toEqual([]);
  });

  test("every policy entry corresponds to a real mutating route on disk", () => {
    const known = new Set(mutatingRoutes);
    const stale = Object.keys(API_WRITE_POLICY).filter((r) => !known.has(r)).sort();
    expect(stale).toEqual([]);
  });

  test("the mutating surface is non-empty, so an empty walk can never pass silently", () => {
    expect(mutatingRoutes.length).toBeGreaterThan(100);
  });

  test("every tier names a real role group (or PUBLIC)", () => {
    const valid = new Set([...Object.keys(ROLE_GROUPS), "PUBLIC"]);
    const bad = Object.entries(API_WRITE_POLICY).filter(([, tier]) => !valid.has(tier));
    expect(bad).toEqual([]);
  });

  test("only the three routes that are public by design carry the PUBLIC tier", () => {
    const publicRoutes = Object.entries(API_WRITE_POLICY)
      .filter(([, tier]) => tier === "PUBLIC")
      .map(([route]) => route)
      .sort();
    // /org/invites/preview is GET-only, so it has no write policy entry at all.
    expect(publicRoutes).toEqual(["/contact", "/org/provision"]);
  });

  test("no mutating route outside the PUBLIC pair is left ungated", () => {
    const ungated = mutatingRoutes.filter((r) => {
      const tier = API_WRITE_POLICY[r];
      return tier === "PUBLIC" && r !== "/contact" && r !== "/org/provision";
    });
    expect(ungated).toEqual([]);
  });
});

describe("resolveWriteTier", () => {
  test("matches a static route exactly", () => {
    expect(resolveWriteTier("/api/payroll/runs")).toBe("ORG_ADMIN");
    expect(resolveWriteTier("/api/work-progress")).toBe("FIELD");
  });

  test("matches a dynamic segment as a single-segment wildcard", () => {
    expect(resolveWriteTier("/api/timesheets/abc123/approve")).toBe("PM_OR_ABOVE");
    expect(resolveWriteTier("/api/timesheets/abc123/submit")).toBe("ANY_MEMBER");
    expect(resolveWriteTier("/api/floor-plans/p1/rooms/r2")).toBe("PM_OR_ABOVE");
  });

  test("does not let a deeper path escape its parent's tier", () => {
    // Not a real route (Next.js would 404 it), but it must never resolve to
    // something weaker than the nearest ancestor.
    expect(resolveWriteTier("/api/payroll/runs/x/y/z")).toBe("ORG_ADMIN");
  });

  test("an entirely unknown path falls back to the strict default, not to allow", () => {
    expect(resolveWriteTier("/api/not-a-real-surface")).toBe(DEFAULT_WRITE_TIER);
    expect(DEFAULT_WRITE_TIER).toBe("FIELD");
  });
});

describe("checkApiWriteAccess", () => {
  test("never gates a GET -- read scoping is a separate concern", () => {
    for (const role of ALL_ORG_ROLES) {
      expect(checkApiWriteAccess("GET", "/api/payroll/runs", role).allowed).toBe(true);
    }
  });

  test("blocks the recorded escalation: a site_engineer creating an employee", () => {
    const result = checkApiWriteAccess("POST", "/api/employees", "site_engineer");
    expect(result.allowed).toBe(false);
  });

  test("blocks a client_viewer from every mutating route it is not explicitly granted", () => {
    const denied = Object.entries(API_WRITE_POLICY)
      .filter(([, tier]) => tier !== "PUBLIC" && tier !== "ANY_ROLE")
      .filter(([route]) => checkApiWriteAccess("POST", `/api${route}`, "client_viewer").allowed);
    expect(denied).toEqual([]);
  });

  test("still lets a client_viewer mark a notification read and reply in a conversation", () => {
    expect(checkApiWriteAccess("PATCH", "/api/notifications/n1/read", "client_viewer").allowed).toBe(true);
    expect(checkApiWriteAccess("POST", "/api/conversations/c1/messages", "client_viewer").allowed).toBe(true);
  });

  test("an owner is never blocked anywhere", () => {
    const denied = Object.keys(API_WRITE_POLICY).filter(
      (route) => !checkApiWriteAccess("POST", `/api${route}`, "owner").allowed
    );
    expect(denied).toEqual([]);
  });

  test("a null role is left to requireAuth() to answer, not turned into a 403", () => {
    // requireAuth() returns 400 'No organization' / 503 for this shape; a 403
    // here would misreport the reason.
    expect(checkApiWriteAccess("POST", "/api/payroll/runs", null).allowed).toBe(true);
  });

  test("the public pair stays reachable with no role at all", () => {
    expect(checkApiWriteAccess("POST", "/api/contact", "client_viewer").allowed).toBe(true);
    expect(checkApiWriteAccess("POST", "/api/org/provision", "client_viewer").allowed).toBe(true);
  });
});

describe("the policy agrees with the requireRole() calls already in the routes", () => {
  // The 13 routes that already had a gate are the reference implementation.
  // If this table ever contradicts one of them, the weaker of the two would be
  // misleading -- so assert they match exactly.
  test("every in-route ROLE_GROUPS.X matches this table's tier for that route", () => {
    const mismatches: string[] = [];
    for (const { route, source } of onDisk) {
      const groups = [...source.matchAll(/requireRole\(\s*ctx\s*,\s*ROLE_GROUPS\.([A-Z_]+)/g)].map((m) => m[1]);
      if (groups.length === 0) continue;
      const tier = API_WRITE_POLICY[route];
      if (!tier) continue; // GET-only route with a read gate; not this table's business
      for (const g of new Set(groups)) {
        if (g !== tier) mismatches.push(`${route}: route says ${g}, policy says ${tier}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
