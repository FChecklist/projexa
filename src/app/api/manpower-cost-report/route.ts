import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R39/R-C07: this used to call /construction/manpower/cost-report, a
// VERIDIAN endpoint that was never actually built (confirmed: no matching
// route file anywhere in compliance-tracker) -- every real call through this
// proxy would 404. The real, live report is REPORT_REGISTRY's
// 'manpower-cost' entry, already reachable at /reports/manpower-cost. Fixed
// to point at the real thing instead of building a duplicate endpoint.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  const trade = request.nextUrl.searchParams.get("trade");
  const date = request.nextUrl.searchParams.get("date");
  const qs = [
    trade ? `&trade=${encodeURIComponent(trade)}` : "",
    date ? `&date=${encodeURIComponent(date)}` : "",
  ].join("");
  try {
    const data = await callVeridian(`/reports/manpower-cost?projectId=${encodeURIComponent(projectId)}${qs}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load manpower cost report");
  }
});
