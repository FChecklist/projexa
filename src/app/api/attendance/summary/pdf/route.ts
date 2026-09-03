import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 D-31: byte-for-byte PDF relay for the attendance summary. Same pattern as
// src/app/api/work-progress/report/pdf/route.ts -- PROJEXA has no PDF library
// of its own and must not gain one; VERIDIAN renders it
// (src/lib/pdf/attendance-summary-pdf.ts) and these bytes are passed through.
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
    const upstream = await callVeridianRaw(`/attendance/summary/pdf?${qs.toString()}`, { organizationId: ctx.organizationId! });
    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? `attachment; filename="attendance-summary-${projectId}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate the attendance summary PDF" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
