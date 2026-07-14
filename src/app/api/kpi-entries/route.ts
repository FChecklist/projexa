import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// KPI entries (actual values submitted against a definition) live at
// /api/v1/construction/kpi-entries -- never re-exported under /projexa/*,
// same pattern as labour-roster. See veridian-client.ts's `root` option.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const kpiDefinitionId = request.nextUrl.searchParams.get("kpiDefinitionId");
  if (!kpiDefinitionId) return NextResponse.json({ error: "kpiDefinitionId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/kpi-entries?kpiDefinitionId=${encodeURIComponent(kpiDefinitionId)}`, { root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load KPI entries" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/kpi-entries", { method: "POST", body, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to submit KPI entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
