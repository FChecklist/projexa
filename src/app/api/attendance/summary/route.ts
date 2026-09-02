import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-31 (R-090): the trade-wise attendance summary the Manpower screen
// shows. Thin relay -- every number is computed in VERIDIAN by
// construction-reports-service.ts's own aggregates, so the screen, the PDF and
// the shared link all read one implementation.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const qs = new URLSearchParams({ projectId });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  try {
    const data = await callVeridian(`/attendance/summary?${qs.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load the attendance summary" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
