import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 D-57: the Cost Report's From/To parameter bar. Both optional and both
  // forwarded intact -- VERIDIAN filters in the grouped aggregate, so this
  // never pulls a project's whole receipt history back to narrow it here.
  const search = new URLSearchParams({ projectId });
  for (const key of ["from", "to"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) search.set(key, value);
  }

  try {
    const data = await callVeridian(`/construction/materials/cost-report?${search.toString()}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load material cost report" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
