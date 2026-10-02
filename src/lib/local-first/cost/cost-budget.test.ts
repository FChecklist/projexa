import { describe, expect, test } from "bun:test";
import { EDGE_FREE_MONTHLY, MIN_LAPTOPS_IN_FREE_QUOTA, SCENARIO_BUDGETS, invocations, project, routeOf } from "./budget";
import { coldStart, idle8h, jobsIdle8h, reconnect3d, tenLaptops, workday, type ScenarioResult } from "./scenarios";

// THE ENFORCED BUDGET (package lf-e6, R14 cost near zero / G4 our server minimal). Every scenario of the brief is run on the
// harness -- the REAL laptop code against the fake sync server -- and its requests are held to SCENARIO_BUDGETS (budget.ts).
// A change that adds polling, a per-(project x kind) sweep, or a call per navigation breaks THIS test, not the owner's bill.
// The printed table is what docs/local-first/COST_MODEL.md records (`bun test --isolate src/lib/local-first/cost/cost-budget.test.ts`).

const table: string[] = [];
function note(r: ScenarioResult) {
  const routes = Object.entries(r.perLaptop).map(([k, v]) => `${k} ${v}`).join(", ");
  table.push(`${r.name.padEnd(22)} ${String(r.perLaptopTotal).padStart(7)}  (${routes})`);
}

describe("cost budget per scenario (requests per laptop, push ops counted twice: the push and its exec run)", () => {
  test("(a) idle for 8 hours, online, tab visible", async () => {
    const r = await idle8h();
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.idle8h);
    expect(r.perLaptop.pull ?? 0).toBe(0); // nothing changed: not one keyset page
    expect(r.perLaptop.ids ?? 0).toBe(0);
  }, 120_000);

  test("(b) a working day: 30 own edits, 30 colleague changes, 40 screens", async () => {
    const r = await workday();
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.workday);
    expect(r.perLaptop.push).toBe(30); // every edit reached the server (cost is never saved by not syncing)
    expect(r.perLaptop.execOps).toBe(30);
    expect(r.perLaptop.pull ?? 0).toBe(0);
    const month = project(invocations(r.perLaptop));
    expect(month.laptopsAllowed).toBeGreaterThanOrEqual(MIN_LAPTOPS_IN_FREE_QUOTA);
    table.push(`  -> ${month.perDay} a working day, ${month.perMonth} a month (22 days): ${month.laptopsAllowed} laptops fit in ${EDGE_FREE_MONTHLY.toLocaleString("en-US")}`);
  }, 300_000);

  test("(c) cold start with an empty database, 5 projects x 28 kinds: one page per pair and no id-list repair", async () => {
    const r = await coldStart();
    note(r);
    expect(r.complete).toBe(true);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.coldStart5Projects);
    expect(r.perLaptop.pull).toBe(5 * 28);
    expect(r.perLaptop.ids ?? 0).toBe(0);
  }, 120_000);

  test("(d) offline for 3 days, then reconnect: nothing sent while offline, a small catch-up, everything current", async () => {
    const r = await reconnect3d();
    note(r);
    expect(r.whileOffline).toBe(0);
    expect(r.caughtUp).toBe(true);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.reconnectAfter3Days);
  }, 120_000);

  test("(e) 10 laptops of one organisation, peers connected, each a working day", async () => {
    const r = await tenLaptops();
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.tenLaptopsPerLaptop);
    expect(r.perLaptop.push).toBe(30);
    const month = project(invocations(r.perLaptop));
    table.push(`  -> the organisation: ${Math.round(month.perMonth * 10)} a month for 10 laptops; ${month.laptopsAllowed} such laptops fit in the free quota`);
  }, 600_000);

  test("jobs claim loop, if switched on: 8 visible idle hours", async () => {
    const r = await jobsIdle8h();
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.jobsClaimIdle8h);
    console.log(["", "COST HARNESS (requests per laptop)", ...table].join("\n"));
  }, 120_000);
});

describe("the budget arithmetic", () => {
  test("a working day -> a month -> laptops in the free quota", () => {
    expect(project(200)).toEqual({ perDay: 200, perMonth: 4400, laptopsAllowed: 113 });
    expect(project(0).laptopsAllowed).toBe(Number.POSITIVE_INFINITY);
  });
  test("a pushed op is counted as two invocations (the push and its exec run)", () => {
    expect(invocations({ push: 1, execOps: 3, changes: 2 })).toBe(6);
  });
  test("routes", () => {
    expect(routeOf("/pull", { ids: ["a"] })).toBe("pull_ids");
    expect(routeOf("/pull", { after: null })).toBe("pull");
    expect(routeOf("/release/current")).toBe("release_current");
    expect(routeOf("/jobs/claim")).toBe("jobs_claim");
    expect(routeOf("/nope")).toBe("other");
  });
});
