import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, scan, routeMatches, INVENTORY_PATH } from "../../scripts/vercel-route-inventory.mjs";

// AUDIT-100 A2 / A3: the number of PROJEXA routes that run on Vercel cannot grow silently, and the /api calls the on-laptop shell can make are a
// named, short list. The inventory is ai-os/audit37/vercel-route-inventory.json; rewrite it with `node scripts/vercel-route-inventory.mjs --write`.
// The "can fail" tests below plant a change in a COPY of the inventory and prove the check names it.

type Inventory = {
  max_routes: number;
  shell_api_references: string[];
  install_phase_api_allowlist: string[];
  daily_use_api_allowlist: string[];
  routes: { route: string; why: string; plan: string; shell_reachable: boolean; methods: string[] }[];
};
const inventory = (): Inventory => JSON.parse(readFileSync(INVENTORY_PATH as string, "utf8"));
const copy = (): Inventory => structuredClone(inventory());

describe("Vercel route inventory (A2/A3)", () => {
  test("the committed inventory matches the code: every route named with a reason and a plan, none missing, none extra", () => {
    expect(check(inventory())).toEqual([]);
  }, 60_000);

  test("the budget is the real number of routes and is not above the measured 311 of 2026-10-05", () => {
    const inv = inventory();
    const { routes } = scan() as { routes: unknown[] };
    expect(routes.length).toBe(inv.routes.length);
    expect(inv.max_routes).toBeLessThanOrEqual(311);
    expect(routes.length).toBeLessThanOrEqual(inv.max_routes);
  });

  test("the on-laptop shell makes calls to a short, named list of /api routes, and each one is a real route", () => {
    const inv = inventory();
    expect(inv.shell_api_references.length).toBeLessThanOrEqual(8);
    for (const ref of inv.shell_api_references) {
      expect(inv.routes.some((r) => routeMatches(ref, r.route)), `${ref} is not a route`).toBe(true);
    }
    // the e2e measures that a daily walk uses only these (e2e/lf-lifecycle-vercel-budget.spec.ts); both lists must be inside the shell's references
    const reachable = inv.routes.filter((r) => r.shell_reachable).map((r) => r.route);
    expect(reachable.length).toBeGreaterThan(0);
    for (const entry of inv.daily_use_api_allowlist) {
      const route = entry.split(" ")[1]!;
      expect(inv.routes.some((r) => routeMatches(route, r.route)), `${entry} is not a route`).toBe(true);
    }
    expect(inv.daily_use_api_allowlist.length).toBeLessThanOrEqual(2);
  });

  test("CAN FAIL: a new route that is not in the inventory is reported", () => {
    const inv = copy();
    const removed = inv.routes.splice(0, 1)[0]!;
    const problems = check(inv) as string[];
    expect(problems.some((p) => p.includes("NEW route") && p.includes(removed.route))).toBe(true);
  });

  test("CAN FAIL: a route that was deleted from the code but is still listed is reported", () => {
    const inv = copy();
    inv.routes.push({ route: "/api/zz-gone", why: "a route that does not exist any more, for the test", plan: "remove it", shell_reachable: false, methods: ["GET"] });
    expect((check(inv) as string[]).some((p) => p.includes("no longer exists") && p.includes("/api/zz-gone"))).toBe(true);
  });

  test("CAN FAIL: growing past the budget is reported", () => {
    const inv = copy();
    inv.max_routes = inv.routes.length - 1;
    expect((check(inv) as string[]).some((p) => p.includes("must not grow"))).toBe(true);
  });

  test("CAN FAIL: a route with no reason written is reported", () => {
    const inv = copy();
    inv.routes[3]!.why = "";
    expect((check(inv) as string[]).some((p) => p.includes("no reason"))).toBe(true);
  });

  test("CAN FAIL: a new /api call from the shell code that is not in the list is reported", () => {
    const inv = copy();
    inv.shell_api_references = inv.shell_api_references.slice(1);
    expect((check(inv) as string[]).some((p) => p.includes("a new Vercel call from the laptop"))).toBe(true);
  });

  test("every shell source file path scanned exists in this checkout (the guard is not reading an empty folder)", () => {
    const { shellApiReferences } = scan() as { shellApiReferences: string[] };
    expect(shellApiReferences.length).toBeGreaterThanOrEqual(5);
    expect(shellApiReferences).toContain("/api/local-first/client-error");
    expect(readFileSync(join(import.meta.dir, "..", "lib", "local-first", "usage-telemetry.ts"), "utf8").length).toBeGreaterThan(0);
  });
});
