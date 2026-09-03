import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 E-05 (R-103): the Cost Report gained a period and a grouping, so the
// proxy has to carry them. Forwarded rather than interpreted -- compliance-
// tracker's own route is the one place that decides what a missing or
// nonsensical parameter means, and duplicating that judgement here is how the
// two ends start disagreeing.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const upstream = new URLSearchParams({ projectId });
  for (const key of ["from", "to", "groupBy"]) {
    const value = searchParams.get(key);
    if (value) upstream.set(key, value);
  }

  try {
    const data = await callVeridian(`/construction/materials/cost-report?${upstream.toString()}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load material cost report" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
