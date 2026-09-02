import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// KPI entries (actual values submitted against a definition) live at
// /api/v1/construction/kpi-entries -- never re-exported under /projexa/*,
// same pattern as labour-roster. See veridian-client.ts's `root` option.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const kpiDefinitionId = request.nextUrl.searchParams.get("kpiDefinitionId");
  if (!kpiDefinitionId) return NextResponse.json({ error: "kpiDefinitionId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/kpi-entries?kpiDefinitionId=${encodeURIComponent(kpiDefinitionId)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load KPI entries");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/kpi-entries", { organizationId: ctx.organizationId!, method: "POST", body, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit KPI entry");
  }
});
