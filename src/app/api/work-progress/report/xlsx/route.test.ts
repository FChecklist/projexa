/// <reference types="bun-types" />
// The XLSX relay is the one export path with NOTHING in front of it: the
// browser follows an anchor straight to this route and either saves a workbook
// or saves whatever else came back. So the properties worth pinning are the
// ones a reader would only discover by opening a broken file --
//   * the upstream's own Content-Type and Content-Disposition are forwarded
//     verbatim, so the file arrives named after its project (E-36's rule) and
//     not as the raw cuid this route would otherwise fall back to;
//   * a failing upstream becomes ITS status, not a 200 carrying an error body
//     with an .xlsx name on it;
//   * the org API key never leaves the server -- the browser hits this route,
//     which is why it exists at all.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { user: { id: string } | null; organizationId: string | null; role: string | null; response: NextResponse | null };
let mockCtx: Ctx;

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const askedPaths: string[] = [];
let upstream: { body: string; headers: Record<string, string> } | null = null;
let upstreamError: { message: string; status: number } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridianRaw: async (path: string) => {
    askedPaths.push(path);
    if (upstreamError) throw new FakeVeridianApiError(upstreamError.message, upstreamError.status);
    return new Response(upstream!.body, { status: 200, headers: upstream!.headers });
  },
  VeridianApiError: FakeVeridianApiError,
}));

const { GET } = await import("./route");

const SHEET_HEADERS = {
  "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "Content-Disposition": 'attachment; filename="work-progress-report-cedar-heights-villa-2026-08-01-to-2026-08-31.xlsx"',
};

function call(query: string) {
  return GET(new NextRequest(`http://test/api/work-progress/report/xlsx?${query}`));
}

const VALID = "projectId=proj-1&from=2026-08-01&to=2026-08-31";

describe("GET /api/work-progress/report/xlsx", () => {
  test("forwards the upstream's content type and its project-named filename", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    upstreamError = null;
    upstream = { body: "PKfake-workbook", headers: SHEET_HEADERS };
    askedPaths.length = 0;

    const res = await call(VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SHEET_HEADERS["Content-Type"]);
    // The project's NAME, not its cuid -- the fallback filename in this route
    // would have used the id, and Content-Disposition wins over <a download>.
    expect(res.headers.get("Content-Disposition")).toContain("cedar-heights-villa");
    expect(await res.text()).toBe("PKfake-workbook");

    expect(askedPaths).toHaveLength(1);
    expect(askedPaths[0]).toContain("projectId=proj-1");
    expect(askedPaths[0]).toContain("from=2026-08-01");
    expect(askedPaths[0]).toContain("to=2026-08-31");
    // Point 11's third-column toggle defaults to total, and the screen, the PDF
    // and the sheet all have to agree about it.
    expect(askedPaths[0]).toContain("mode=total");
  });

  test("?mode=balance is passed through; anything else falls back to total", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    upstreamError = null;
    upstream = { body: "x", headers: SHEET_HEADERS };

    askedPaths.length = 0;
    await call(`${VALID}&mode=balance`);
    expect(askedPaths[0]).toContain("mode=balance");

    askedPaths.length = 0;
    await call(`${VALID}&mode=nonsense`);
    expect(askedPaths[0]).toContain("mode=total");
  });

  test("a non-2xx upstream becomes its own status and message, never a 200 named .xlsx", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    upstreamError = { message: "Project not found", status: 404 };

    const res = await call(VALID);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect((await res.json()).error).toBe("Project not found");
  });

  test("an upstream failure that is not a VeridianApiError is reported as a 502, not swallowed", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    upstreamError = null;
    upstream = null; // makes the mock throw a plain TypeError on `upstream!.body`

    const res = await call(VALID);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Failed to generate work progress report spreadsheet");
  });

  test("the parameters the sheet cannot be built without are demanded before any upstream call", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    upstreamError = null;
    upstream = { body: "x", headers: SHEET_HEADERS };

    askedPaths.length = 0;
    const noProject = await call("from=2026-08-01&to=2026-08-31");
    expect(noProject.status).toBe(400);
    expect((await noProject.json()).error).toContain("projectId");

    const noRange = await call("projectId=proj-1");
    expect(noRange.status).toBe(400);
    expect((await noRange.json()).error).toContain("from and to");

    expect(askedPaths).toHaveLength(0);
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    askedPaths.length = 0;
    const res = await call(VALID);
    expect(res.status).toBe(401);
    expect(askedPaths).toHaveLength(0);
  });
});
