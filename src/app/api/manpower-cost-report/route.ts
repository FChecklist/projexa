import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  const trade = request.nextUrl.searchParams.get("trade");
  const qs = trade ? `&trade=${encodeURIComponent(trade)}` : "";
  try {
    const data = await callVeridian(`/construction/manpower/cost-report?projectId=${encodeURIComponent(projectId)}${qs}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load manpower cost report" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
