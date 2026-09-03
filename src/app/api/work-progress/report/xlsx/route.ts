import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 E-28 (R-244 / R-254): byte-for-byte XLSX relay for the Work Progress
// Report, the twin of the PDF relay beside it.
//
// PROJEXA has no spreadsheet library and must not gain one -- so the workbook
// is built by VERIDIAN (compliance-tracker
// src/app/api/v1/projexa/work-progress/report/xlsx/route.ts, over the same
// computeRows arithmetic the PDF prints and the screen shows) and streamed
// through here so the browser never carries the org API key. Until this
// existed, the header's "Export XLSX" was a CSV built in the browser wearing
// the wrong label.
//
// Query params mirror ../route.ts and ../pdf/route.ts exactly, including point
// 11's ?mode=total|balance toggle, so the three cannot disagree about which
// reading of the third column they are showing.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total";
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 });

  const qs = `projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`;

  try {
    const upstream = await callVeridianRaw(`/work-progress/report/xlsx?${qs}`, {
      organizationId: ctx.organizationId!,
      // The browser giving up on a download must stop the workbook being built.
      signal: request.signal,
    });
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // The upstream names the file after the project and the period; only
        // fall back when it did not.
        "Content-Disposition":
          upstream.headers.get("Content-Disposition") ??
          `attachment; filename="work-progress-report-${projectId}-${from}-to-${to}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate work progress report spreadsheet" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
