import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 E-07 (R-114): byte-for-byte relay for the Budget Summary / Cost Variance
// report's server-rendered exports. Same pattern as
// src/app/api/construction-materials/cost-report/export/route.ts and
// src/app/api/work-progress/report/pdf/route.ts.
//
// PROJEXA HAS NO PDF OR XLSX LIBRARY AND MUST NOT GAIN ONE. VERIDIAN builds
// the bytes -- the PDF through src/lib/pdf/budget-variance-report-pdf.ts, the
// XLSX and CSV through src/lib/report-export-shared.ts's rowsToXLSXBuffer /
// rowsToCSV with their formula-injection guard -- from the SAME
// boqBudgetVarianceReport call and the SAME category/vendor filters the screen
// used, so an exported file can never disagree with the table it came from.
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
  // Repeatable `category`, forwarded one by one -- a real category name may
  // contain a comma, so they are never joined into one value.
  for (const category of searchParams.getAll("category")) {
    if (category.trim() !== "") upstream.append("category", category);
  }
  const vendorId = searchParams.get("vendorId");
  if (vendorId) upstream.set("vendorId", vendorId);

  try {
    const res = await callVeridianRaw(`/reports/budget-variance/export?${upstream.toString()}`, {
      organizationId: ctx.organizationId!,
    });
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? CONTENT_TYPE[format],
        "Content-Disposition": res.headers.get("content-disposition") ?? `attachment; filename="budget-variance.${format}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to export the budget variance report" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
