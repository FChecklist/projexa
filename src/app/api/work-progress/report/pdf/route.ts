import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// Point 117: byte-for-byte PDF relay for the Work Progress Report. Same
// pattern as src/app/api/moms/[id]/pdf/route.ts -- PROJEXA has no PDF library
// of its own and must not gain one; VERIDIAN generates the real PDF (point
// 138, src/lib/pdf/work-progress-report-pdf.ts, shipped in #1314). Query
// params mirror src/app/api/work-progress/report/route.ts exactly, plus point
// 11's ?mode=total|balance toggle, which the upstream route already accepts.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // Default to "total" on anything that is not exactly "balance" -- same
  // normalisation the upstream route does, so the two can never disagree.
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total";
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 });

  const qs = `projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`;

  try {
    const upstream = await callVeridianRaw(`/work-progress/report/pdf?${qs}`, { organizationId: ctx.organizationId! });
    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? `attachment; filename="work-progress-report-${projectId}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate work progress report PDF" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
