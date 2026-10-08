import { describe, expect, test } from "bun:test";
import { DELTA_BUDGETS, EDGE_FREE_MONTHLY, MIN_LAPTOPS_IN_FREE_QUOTA, SCENARIO_BUDGETS, invocations, project, routeOf } from "./budget";
import { coldStart, delta, idle8h, jobsIdle8h, reconnect3d, tenLaptops, workday, type ScenarioResult } from "./scenarios";

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
  // Package lf-fc (wire:F07): the first copy is PACED (rate-pacer.ts, 100 a minute) and the harness world enforces the server's REAL cap (120 a
  // minute per person, 429 + Retry-After) again. Before the pacer this scenario sent ~160 requests in the same simulated instant.
  test("(c2) cold start of 5 projects under the REAL 120 requests/minute cap: paced, no 429, complete", async () => {
    const r = await coldStart();
    table.push(`  (c2) under the real cap: ${r.limited} answered 429, busiest minute ${r.busiestMinute} requests, ${r.storedRows} rows of the checked kinds on the laptop`);
    expect(r.limited).toBe(0);
    expect(r.busiestMinute).toBeLessThanOrEqual(120);
    expect(r.complete).toBe(true);
    expect(r.storedRows).toBe(5 * (22 + 2 + 2));
  }, 120_000);
  test("(a) idle for 8 hours, online, tab visible", async () => {
    const r = await idle8h();
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.idle8h);
    expect(r.perLaptop.pull ?? 0).toBe(0); // nothing changed: not one keyset page
    expect(r.perLaptop.ids ?? 0).toBe(0);
    expect(r.perLaptop.changes ?? 0).toBe(0); // FC cost:COST-03: nothing moved, so no feed was read -- only GET /heads
  }, 120_000);

  test("(a') idle for 8 hours with 20 projects: still about one request per round (GET /heads does not grow with projects)", async () => {
    const r = await idle8h({}, { projects: 20 });
    note(r);
    expect(r.perLaptopTotal).toBeLessThanOrEqual(SCENARIO_BUDGETS.idle8h20Projects);
    expect(r.perLaptop.changes ?? 0).toBe(0);
  }, 300_000);

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

  // DELTA-ONLY (the owner's rule: after the first copy, only what changed crosses the wire). docs/local-first/DELTA_ONLY.md paths 2 and 3.
  test("(f) delta: a quiet half hour moves no row body; one edit costs one op and one row; one colleague change costs one row", async () => {
    const r = await delta();
    const first = r.firstCopy.responseBytes + r.firstCopy.requestBytes;
    table.push(`  (f) delta: first copy ${r.firstCopy.rowBodies} row bodies / ${first} bytes; one edit -> A ${r.editOnA.a.requestBytes + r.editOnA.a.responseBytes} B, colleague ${r.editOnA.b.requestBytes + r.editOnA.b.responseBytes} B`);
    // the first copy is the yardstick: it really did copy everything once
    expect(r.firstCopy.rowBodies).toBeGreaterThanOrEqual(5 * 28);
    // quiet: no row body, a few bytes of /heads
    for (const w of [r.quiet.a, r.quiet.b]) {
      expect(w.rowBodies).toBe(DELTA_BUDGETS.quietRowBodies);
      expect(w.changeEntries).toBe(0);
      expect(w.idsListed).toBe(0);
      expect(w.requestBytes + w.responseBytes).toBeLessThanOrEqual(DELTA_BUDGETS.quietBytesPerLaptop);
    }
    // one edit on A: A sends ONE op; B receives exactly the ONE changed row; neither reads an id list
    expect(r.editOnA.a.pushOps).toBe(1);
    expect(r.editOnA.a.requestBytes).toBeLessThanOrEqual(DELTA_BUDGETS.editSenderRequestBytes); // the op carries the changed field(s) and the base version, not the record
    expect(r.editOnA.a.rowBodies).toBeLessThanOrEqual(DELTA_BUDGETS.editSenderRowBodies);
    expect(r.editOnA.b.rowBodies).toBe(DELTA_BUDGETS.editReceiverRowBodies);
    expect(r.editOnA.a.changeEntries).toBeLessThanOrEqual(DELTA_BUDGETS.changeEntriesPerRead);
    expect(r.editOnA.b.changeEntries).toBeLessThanOrEqual(DELTA_BUDGETS.changeEntriesPerRead);
    expect(r.editOnA.a.idsListed + r.editOnA.b.idsListed).toBe(0);
    const edit = r.editOnA.a.requestBytes + r.editOnA.a.responseBytes + r.editOnA.b.requestBytes + r.editOnA.b.responseBytes;
    expect(edit).toBeLessThanOrEqual(first * DELTA_BUDGETS.editFractionOfFirstCopy);
    // one colleague change on the server: each laptop receives that one row
    expect(r.colleagueChange.a.rowBodies).toBe(DELTA_BUDGETS.colleagueRowBodies);
    expect(r.colleagueChange.b.rowBodies).toBe(DELTA_BUDGETS.colleagueRowBodies);
    expect(r.colleagueChange.a.pushOps + r.colleagueChange.b.pushOps).toBe(0);
    expect(r.colleagueChange.a.requestBytes + r.colleagueChange.a.responseBytes).toBeLessThanOrEqual(first * DELTA_BUDGETS.editFractionOfFirstCopy);
  }, 300_000);

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
