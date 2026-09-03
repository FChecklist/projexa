import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 E-05 (R-103): byte-for-byte relay for the Material Cost Report's
// server-rendered exports. Same pattern as src/app/api/work-progress/report/
// pdf/route.ts and src/app/api/moms/[id]/pdf/route.ts.
//
// PROJEXA HAS NO PDF OR XLSX LIBRARY AND MUST NOT GAIN ONE. VERIDIAN builds
// the bytes -- the PDF through src/lib/pdf/material-cost-report-pdf.ts, the
// XLSX and CSV through src/lib/report-export-shared.ts's rowsToXLSXBuffer /
// rowsToCSV with their formula-injection guard -- from the SAME
// getMaterialCostReport call and the SAME parameters this screen used, so an
// exported file can never disagree with the table it came from.
const FORMATS = new Set(["pdf", "xlsx", "csv"]);

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const format = searchParams.get("format") ?? "pdf";
  if (!FORMATS.has(format)) {
    return NextResponse.json({ error: `Unknown format. Valid formats: ${[...FORMATS].join(", ")}` }, { status: 400 });
  }

  const upstream = new URLSearchParams({ projectId, format });
  for (const key of ["from", "to", "groupBy"]) {
    const value = searchParams.get(key);
    if (value) upstream.set(key, value);
  }

  try {
    const res = await callVeridianRaw(`/construction/materials/cost-report/export?${upstream.toString()}`, {
      organizationId: ctx.organizationId!,
      root: true,
    });
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? CONTENT_TYPE[format],
        "Content-Disposition": res.headers.get("Content-Disposition") ?? `attachment; filename="material-cost-report-${projectId}.${format}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to export the material cost report" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
