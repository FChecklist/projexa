/// <reference types="bun-types" />
// R67 E-12 (R-136) fix pass. This relay is the one path every schema-driven
// report document takes out of PROJEXA, and it shipped without a test -- which
// is how it came to drop `from`/`to` silently. The Design Studio Cost Analysis
// screen passes projectId + from + to (DesignStudioCostAnalysisClient's
// exportParams) and VERIDIAN's handler reads exactly those before calling
// designerTimesheetReport, so a dropped period does not error: it quietly
// returns a document for the whole project stamped "whole project to date"
// while the table on screen shows one month. Nothing in the response says so.
//
// These tests therefore assert the UPSTREAM PATH, which is the only place that
// mistake is visible, and pin the repeatable-`category` behaviour beside it so
// a future edit cannot "tidy" the two loops into one join.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let lastPath: string | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

class MockVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridianRaw: async (path: string) => {
    lastPath = path;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  },
  VeridianApiError: MockVeridianApiError,
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "manager", response: null };
}

function request(query: string) {
  const url = `http://test/api/reports/designer-timesheet/export?${query}`;
  return { nextUrl: new URL(url) } as unknown as import("next/server").NextRequest;
}

/** The upstream query VERIDIAN was actually called with. */
function upstreamParams(): URLSearchParams {
  expect(lastPath).not.toBeNull();
  return new URL(lastPath!, "http://veridian.test").searchParams;
}

describe("GET /api/reports/[reportName]/export", () => {
  test("the report's PERIOD reaches VERIDIAN -- a designer-timesheet export carries from and to", async () => {
    mockCtx = ctx();
    lastPath = null;

    const res = await GET(request("projectId=p-1&from=2026-08-01&to=2026-08-31&format=pdf"), {
      params: Promise.resolve({ reportName: "designer-timesheet" }),
    });

    expect(res.status).toBe(200);
    const params = upstreamParams();
    expect(params.get("projectId")).toBe("p-1");
    expect(params.get("format")).toBe("pdf");
    // The regression this file exists for: both of these used to be absent, so
    // VERIDIAN fell back to whole-project history.
    expect(params.get("from")).toBe("2026-08-01");
    expect(params.get("to")).toBe("2026-08-31");
  });

  test("a report run with no period forwards no period -- an absent window is not invented as an empty one", async () => {
    mockCtx = ctx();
    lastPath = null;

    await GET(request("projectId=p-1&format=csv"), {
      params: Promise.resolve({ reportName: "designer-timesheet" }),
    });

    const params = upstreamParams();
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
  });

  test("budget-variance still forwards repeatable categories one by one, never joined", async () => {
    mockCtx = ctx();
    lastPath = null;

    await GET(
      request(
        "projectId=p-1&format=xlsx&category=" +
          encodeURIComponent("Civil, structural") +
          "&category=" +
          encodeURIComponent("MEP") +
          "&vendorId=v-9"
      ),
      { params: Promise.resolve({ reportName: "budget-variance" }) }
    );

    const params = upstreamParams();
    // A real category name may contain a comma -- joining them would split
    // "Civil, structural" into two categories that do not exist.
    expect(params.getAll("category")).toEqual(["Civil, structural", "MEP"]);
    expect(params.get("vendorId")).toBe("v-9");
  });

  test("an unknown format is refused in words before VERIDIAN is called", async () => {
    mockCtx = ctx();
    lastPath = null;

    const res = await GET(request("projectId=p-1&format=docx"), {
      params: Promise.resolve({ reportName: "designer-timesheet" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown format. Valid formats: pdf, xlsx, csv");
    expect(lastPath).toBeNull();
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    lastPath = null;

    const res = await GET(request("projectId=p-1&format=pdf"), {
      params: Promise.resolve({ reportName: "designer-timesheet" }),
    });

    expect(res.status).toBe(401);
    expect(lastPath).toBeNull();
  });
});
