/// <reference types="bun-types" />
// R67 F-13 (R-193/R-217) -- the runnable half of "cut the six-call WPR
// assembly to the minimum set".
//
// THE FAULT. This one report made SIX VERIDIAN calls, three of them wasteful in
// a way that grows with the project's age:
//   - GET /vendors pulled the org's entire vendor master to turn a handful of
//     ids into names;
//   - GET /attendance pulled every attendance row ever recorded (workers x
//     days) and then discarded everything outside [from, to];
//   - GET /work-progress pulled every progress entry ever logged, though the
//     report never looks past `to`.
//
// The acceptance in the item is a Playwright latency run, which needs a live
// pair of servers. What is asserted here is the property behind it: which calls
// this route makes, and with what scoping. The numbers it produces are covered
// by src/lib/work-progress-report.test.ts, including a case proving the
// roster-derived vendor list gives byte-identical output to the vendor master.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let requestedPaths: string[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  // R67 MERGE (D-11, lane E2's E-28): the route also composes request.signal
  // with its own deadline through combineAbortSignals now -- a real function
  // here (not the identity of either input) so a test that ever inspects the
  // signal sees the same OR-combinator shape production code gets.
  combineAbortSignals: (...signals: (AbortSignal | undefined)[]) => {
    const real = signals.filter((s): s is AbortSignal => !!s);
    if (real.length === 1) return real[0];
    const controller = new AbortController();
    for (const s of real) s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
    return controller.signal;
  },
  callVeridian: async (path: string) => {
    requestedPaths.push(path);
    if (path.startsWith("/scope")) {
      return {
        boqs: [
          {
            id: "boq-1", status: "approved", version: 1, title: "Main BOQ",
            lineItems: [{ id: "li-1", itemCode: "1.01", description: "Excavation", quantity: "100", rate: "10", amount: "1000", unit: "m3", activityId: "act-1", parentLineItemId: null }],
          },
        ],
      };
    }
    if (path.startsWith("/work-progress/activities")) {
      return { activities: [{ id: "act-1", categoryId: "cat-1", name: "Excavation" }], categories: [{ id: "cat-1", name: "Substructure" }] };
    }
    if (path.startsWith("/work-progress")) {
      return { entries: [{ id: "e1", activityId: "act-1", boqLineItemId: "li-1", entryDate: "2026-07-12", quantityDone: "40", percentComplete: "40", entryBasis: "DELTA" }] };
    }
    if (path.startsWith("/attendance")) {
      return { attendance: [{ id: "a1", rosterId: "r1", attendanceDate: "2026-07-12", dailyCost: 500 }] };
    }
    if (path.startsWith("/construction/labour-roster")) {
      return { roster: [{ id: "r1", trade: "Mason", vendorId: "v1", name: "Ramesh", vendorName: "ABC Contractors" }] };
    }
    return {};
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null };
}

async function run() {
  mockCtx = ctx();
  requestedPaths = [];
  const res = await GET(new NextRequest("http://test/api/work-progress/report?projectId=p1&from=2026-07-10&to=2026-07-20"));
  return { res, body: await res.json() };
}

describe("GET /api/work-progress/report: the minimum set of VERIDIAN calls", () => {
  test("five calls, and the vendor master is no longer one of them", async () => {
    const { res } = await run();

    expect(res.status).toBe(200);
    expect(requestedPaths).toHaveLength(5);
    expect(requestedPaths.some((p) => p === "/vendors" || p.startsWith("/vendors?"))).toBe(false);
  });

  test("attendance is asked for THIS report's window, not the project's whole history", async () => {
    await run();

    const attendance = requestedPaths.find((p) => p.startsWith("/attendance"));
    expect(attendance).toContain("from=2026-07-10");
    expect(attendance).toContain("to=2026-07-20");
  });

  test("progress entries are capped at `to`, and deliberately NOT floored at `from`", async () => {
    await run();

    const progress = requestedPaths.find((p) => p.startsWith("/work-progress?"));
    expect(progress).toContain("dateTo=2026-07-20");
    // The "previous" column IS the entries before `from`. Sending dateFrom
    // would silently zero it.
    expect(progress).not.toContain("dateFrom");
  });

  test("the vendor breakdown still names its vendor -- from the roster row", async () => {
    const { body } = await run();

    expect(body.byVendor).toEqual([{ vendorId: "v1", vendorName: "ABC Contractors", totalCost: 500 }]);
  });

  test("the report itself is unchanged: scope rows and category rollup still come back", async () => {
    const { body } = await run();

    expect(body.boqId).toBe("boq-1");
    expect(body.rows).toHaveLength(1);
    expect(body.byCategory[0].name).toBe("Substructure");
    expect(body.byManpower).toEqual([{ trade: "Mason", workerDays: 1, totalCost: 500 }]);
  });
});

// R67 E-28 (C-04): `from` is optional -- the effective range comes from the
// earliest progress entry when the caller does not supply one.
describe("GET /api/work-progress/report: from is optional (C-04)", () => {
  test("400 only for a missing `to` -- a missing `from` is not an error", async () => {
    mockCtx = ctx();
    requestedPaths = [];
    const res = await GET(new NextRequest("http://test/api/work-progress/report?projectId=p1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("to");
    expect(body.error).not.toContain("from");
  });

  test("with no `from`, the effective range starts at the earliest entry, not the query param", async () => {
    mockCtx = ctx();
    requestedPaths = [];
    const res = await GET(new NextRequest("http://test/api/work-progress/report?projectId=p1&to=2026-07-20"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fromWasDefaulted).toBe(true);
    // The mocked /work-progress fixture's one entry is dated 2026-07-12.
    expect(body.earliestEntryDate).toBe("2026-07-12");
    expect(body.from).toBe("2026-07-12");
    const attendance = requestedPaths.find((p) => p.startsWith("/attendance"));
    expect(attendance).toContain("from=2026-07-12");
  });

  test("an explicit `from` is still honoured verbatim", async () => {
    const { body } = await run();
    expect(body.fromWasDefaulted).toBe(false);
    expect(body.from).toBe("2026-07-10");
  });
});
