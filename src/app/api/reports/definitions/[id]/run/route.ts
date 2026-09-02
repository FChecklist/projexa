import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16): thin proxy over VERIDIAN's
// POST /api/v1/projexa/reports/definitions/[id]/run, which wraps the same
// executeReportDefinition() dispatcher -- the one real execution path every
// report_definitions row runs through. No execution logic lives here.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const data = await callVeridian(`/reports/definitions/${encodeURIComponent(id)}/run`, {
      organizationId: ctx.organizationId!,
      method: "POST",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to run this report/analysis");
  }
}
