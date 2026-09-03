import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 F-07 (R-100/R-106). This route is deliberately KEPT although /materials
// no longer calls it: the on-screen Cost Report tab now derives its rows from
// the receipts the browser already loaded (src/lib/material-cost-report.ts,
// arithmetic identical to the server's), which removes a third request from
// the landing path. The EXPORTABLE report has no loaded page to derive from,
// so it runs here -- one grouped SQL aggregate in one transaction.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials/cost-report?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load material cost report");
  }
});
