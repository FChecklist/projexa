import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-53 (audit R-181). ONE hop, deliberately.
//
// The trade-wise counts and the people behind them used to be two separate
// VERIDIAN reports (attendanceReport + manpowerCostReport), and /labour already
// costs ~6 s because it makes its hops serially. This proxy therefore calls a
// single VERIDIAN report -- manpower-daily-summary -- which does the join, the
// company lookup and the grouping inside ONE tenant transaction and returns
// { date, rows, totals, people } together. The browser never combines two
// responses, and the pool never pays for two transactions.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const search = new URLSearchParams({ projectId });
  const date = request.nextUrl.searchParams.get("date");
  if (date) search.set("date", date);

  try {
    const data = await callVeridian(`/reports/manpower-daily-summary?${search.toString()}`, {
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load the daily summary" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
