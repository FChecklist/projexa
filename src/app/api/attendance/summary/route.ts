import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-31 (R-090): the trade-wise attendance summary the Manpower screen
// shows. Thin relay -- every number is computed in VERIDIAN by
// construction-reports-service.ts's own aggregates, so the screen, the PDF and
// the shared link all read one implementation.
//
// ---------------------------------------------------------------------------
// D3 x D21 MERGE NOTE (decision D-11). Both lanes independently created this
// exact path for DIFFERENT reports, so git raised it as an add/add:
//
//   D21 (this file, kept): projectId + from + to, relaying VERIDIAN
//     /attendance/summary. It owns the whole family -- ./pdf and ./share are
//     its siblings and call the same upstream. AttendanceSummaryPanel.tsx is
//     the consumer.
//   D3  (folded away):     projectId + date, a SINGLE-DATE report relaying
//     VERIDIAN /reports/manpower-daily-summary for the Manpower Daily Summary
//     tab (D-53). LabourDailySummaryClient.tsx is the consumer.
//
// They are two different reports, so neither could simply win. D3's proxy was
// removed rather than renamed because it was a hand-rolled duplicate of the
// generic /api/reports/[reportName] proxy that has existed since R42 -- same
// upstream prefix, same param forwarding -- and that generic route additionally
// carries withTiming() and veridianErrorResponse(), the R67 F-20 / audit R-238
// helper whose own header names D3's copied `err instanceof VeridianApiError`
// block as the defect it exists to remove. LabourDailySummaryClient now calls
// /api/reports/manpower-daily-summary directly. Nothing was lost: the daily
// summary reaches the same VERIDIAN report through better-instrumented shared
// plumbing, and its test asserts the new URL.
//
// The one thing D3's route had that the generic proxy does not is a local 400
// on a missing projectId. That guard was defensive only -- the client always
// sends one -- and every other report consumer in this app already relies on
// VERIDIAN to reject an incomplete report request.
// ---------------------------------------------------------------------------
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
