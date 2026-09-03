/// <reference types="bun-types" />
// R67 F-28. The budget's decisions, and the shipped perf/budgets.json itself.
//
// This is the testable half of F-28's acceptance ("run the perf job against a
// branch that restores the per-row BOQ compare fetch: it exits non-zero and
// names '/scope' with apiCount above 10"). The browser half needs a running
// server; the decision and the wording do not, and it is the decision and the
// wording that were broken before -- the old harness recorded ms = -1 rows and
// said nothing useful about them.

import { describe, expect, test } from "bun:test";
import {
  allowedFor,
  evaluateAll,
  evaluateRoute,
  parseServerTiming,
  resolveBudget,
  toMarkdown,
  violationLine,
  type RouteBudget,
  type RouteMeasurement,
} from "./perf-budget";
import budgets from "../../perf/budgets.json";

const BUDGET: RouteBudget = {
  route: "/scope",
  label: "Scope of Work",
  ttfbMs: 400,
  fcpMs: 800,
  usableMs: 1500,
  networkIdleMs: 2500,
  apiCalls: 10,
  slowestCallMs: 2000,
};

function measurement(over: Partial<RouteMeasurement> = {}): RouteMeasurement {
  return {
    route: "/scope",
    ttfbMs: 200,
    fcpMs: 500,
    usableMs: 900,
    networkIdleMs: 1400,
    apiCount: 3,
    slowestCallMs: 700,
    slowestCallUrl: "/api/scope?projectId=p1",
    ...over,
  };
}

describe("tolerance", () => {
  test("timing metrics get the 10 % headroom a busy runner needs", () => {
    expect(allowedFor("ttfbMs", 400, 0.1)).toBe(440);
    expect(allowedFor("usableMs", 1500, 0.1)).toBe(1650);
  });

  test("apiCalls gets NO tolerance -- a request count is a design fact, not jitter", () => {
    expect(allowedFor("apiCalls", 10, 0.1)).toBe(10);
  });
});

describe("evaluateRoute", () => {
  test("a screen inside every budget has no violations", () => {
    expect(evaluateRoute(BUDGET, measurement(), 0.1)).toEqual([]);
  });

  test("the /scope regression this budget exists to catch: 22 calls fails, naming the route", () => {
    // Restoring the per-row /api/scope/{id}/compare fan-out R-239 removed puts
    // /scope back at 22 requests. That must fail, and the line must say so.
    const violations = evaluateRoute(BUDGET, measurement({ apiCount: 22 }), 0.1);
    expect(violations).toHaveLength(1);
    expect(violations[0].metric).toBe("apiCalls");
    expect(violations[0].measured).toBe(22);
    const line = violationLine(violations[0]);
    expect(line).toContain("/scope");
    expect(line).toContain("apiCalls=22");
    expect(line).toContain("budget 10");
  });

  test("a screen that never becomes usable is a violation even with no number to report", () => {
    const violations = evaluateRoute(BUDGET, measurement({ usableMs: null }), 0.1);
    expect(violations).toHaveLength(1);
    expect(violations[0].metric).toBe("usableMs");
    expect(violations[0].measured).toBeNull();
    expect(violationLine(violations[0])).toContain("never reached [data-state='ready']");
  });

  test("a metric the browser never reported is NOT a violation -- a measurement gap is not a regression", () => {
    // The previous harness's `ms = -1` rows were exactly this, reported as if
    // they were performance data.
    expect(evaluateRoute(BUDGET, measurement({ fcpMs: null, ttfbMs: null }), 0.1)).toEqual([]);
  });

  test("one slow call fails even when the page total is fine, and names the URL", () => {
    const violations = evaluateRoute(
      BUDGET,
      measurement({ slowestCallMs: 5400, slowestCallUrl: "/api/tasks?limit=50" }),
      0.1
    );
    expect(violations.map((v) => v.metric)).toEqual(["slowestCallMs"]);
    expect(violationLine(violations[0])).toContain("/api/tasks?limit=50");
  });

  test("a value inside the tolerance band passes; one outside it fails", () => {
    expect(evaluateRoute(BUDGET, measurement({ ttfbMs: 440 }), 0.1)).toEqual([]);
    expect(evaluateRoute(BUDGET, measurement({ ttfbMs: 441 }), 0.1)).toHaveLength(1);
  });
});

describe("the report", () => {
  test("evaluateAll collects every route's violations for the exit code", () => {
    const { rows, violations } = evaluateAll(
      [
        { budget: BUDGET, measured: measurement({ apiCount: 22 }) },
        { budget: { ...BUDGET, route: "/moms", label: "Minutes of Meeting" }, measured: measurement({ route: "/moms" }) },
      ],
      0.1
    );
    expect(rows).toHaveLength(2);
    expect(violations).toHaveLength(1);
    expect(violations[0].route).toBe("/scope");
  });

  test("the Markdown table has one row per screen and states the verdict", () => {
    const { rows } = evaluateAll([{ budget: BUDGET, measured: measurement({ apiCount: 22 }) }], 0.1);
    const md = toMarkdown(rows);
    expect(md).toContain("| Scope of Work | `/scope` |");
    expect(md).toContain("apiCalls");
    // A metric with no measurement prints an em-dash, never "-1".
    const { rows: gap } = evaluateAll([{ budget: BUDGET, measured: measurement({ usableMs: null }) }], 0.1);
    expect(toMarkdown(gap)).toContain("| — |");
    expect(toMarkdown(gap)).not.toContain("-1");
  });
});

describe("parseServerTiming", () => {
  test("reads the header withTiming() writes", () => {
    expect(parseServerTiming("upstream;dur=1234, app;dur=56")).toEqual({ upstreamMs: 1234, appMs: 56 });
  });

  test("a missing half stays null rather than becoming a zero-cost call", () => {
    expect(parseServerTiming("upstream;dur=90")).toEqual({ upstreamMs: 90, appMs: null });
    expect(parseServerTiming(null)).toEqual({ upstreamMs: null, appMs: null });
    expect(parseServerTiming("garbage")).toEqual({ upstreamMs: null, appMs: null });
  });
});

describe("the shipped perf/budgets.json", () => {
  test("covers the 13 measured pages and resolves against the defaults", () => {
    expect(budgets.routes).toHaveLength(13);
    for (const route of budgets.routes) {
      const resolved = resolveBudget(budgets.defaults, route as Parameters<typeof resolveBudget>[1]);
      expect(resolved.route.startsWith("/")).toBe(true);
      expect(resolved.label.length).toBeGreaterThan(0);
      for (const key of ["ttfbMs", "fcpMs", "usableMs", "networkIdleMs", "apiCalls", "slowestCallMs"] as const) {
        expect(typeof resolved[key]).toBe("number");
        expect(resolved[key]).toBeGreaterThan(0);
      }
    }
  });

  test("carries the audit's own figures, so a silent relaxation is a failing test", () => {
    expect(budgets.defaults.ttfbMs).toBe(400);
    expect(budgets.defaults.fcpMs).toBe(800);
    expect(budgets.defaults.usableMs).toBe(1500);
    expect(budgets.defaults.networkIdleMs).toBe(2500);
    expect(budgets.defaults.apiCalls).toBe(10);
    expect(budgets.defaults.slowestCallMs).toBe(2000);
    expect(budgets.toleranceFraction).toBe(0.1);
  });

  test("the backend probe covers the screens the audit could not price separately", () => {
    const joined = budgets.backendProbe.paths.join(" ");
    for (const needle of ["/api/moms", "/api/documents", "/api/drawings", "/api/schedule/", "/api/timesheets", "/api/reports/"]) {
      expect(joined).toContain(needle);
    }
  });
});
