import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-24: thin proxy to VERIDIAN's /scope/categories -- the per-line
// Category picklist for the BOQ create and revise grids (the seed trades
// merged with whatever this org already uses). Same error shape as the sibling
// proxy in src/app/api/scope/route.ts.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/scope/categories?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load BOQ categories" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
