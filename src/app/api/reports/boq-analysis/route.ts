import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement #8 ("Profit and Loss analysis for the project") and #7
// ("change of BOQ ... analysis"): VERIDIAN's boq-analysis-service.ts already
// computes "did we make the margin we quoted, and where did it go" (contract
// variance, cost variance against baseline, expected vs actual profit) --
// this proxies its already-shipped, already-tested
// /v1/projexa/reports/boq-analysis, which PROJEXA never had a route to
// reach. GET-only, matching the upstream route's own read-only contract.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const sortBy = request.nextUrl.searchParams.get("sortBy");
  const direction = request.nextUrl.searchParams.get("direction");
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (sortBy) params.set("sortBy", sortBy);
  if (direction) params.set("direction", direction);
  try {
    const data = await callVeridian(`/reports/boq-analysis?${params.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the profit & loss analysis");
  }
});
