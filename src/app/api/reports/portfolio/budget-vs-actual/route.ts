import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 E-33 (R-265). Relay for Sumeet 5.png's first graph -- revenue, budget
// and progress per project, across the portfolio.
//
// A SEPARATE ROUTE FROM /api/reports/[reportName], deliberately. That dynamic
// segment forwards to VERIDIAN's per-project dispatcher and requires a
// projectId; this report has none, because it IS the comparison between
// projects. Two segments deep on both sides, so neither can shadow the other.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  // Forwarded unexamined (departmentId, from, to): VERIDIAN's own route is the
  // one place that knows which filters this report understands.
  const qs = request.nextUrl.searchParams.toString();
  try {
    const data = await callVeridian(`/reports/portfolio/budget-vs-actual${qs ? `?${qs}` : ""}`, {
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load revenue, budget and progress by project" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
