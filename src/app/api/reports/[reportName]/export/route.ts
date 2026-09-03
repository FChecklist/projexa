import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 E-12 (R-136): byte-for-byte relay for the schema-driven report document's
// server-rendered exports, for every report that has a schema.
//
// PROJEXA HAS NO PDF OR XLSX LIBRARY AND MUST NOT GAIN ONE. VERIDIAN builds the
// bytes from the SAME ReportExportSchema PROJEXA's ReportDocument renders the
// on-screen table from -- the PDF through src/lib/pdf/report-document-pdf.ts,
// the XLSX and CSV through src/lib/report-export-shared.ts's rowsToXLSXBuffer /
// rowsToCSV with their formula-injection guard -- so an exported file cannot
// disagree with the table it came from, which is the defect R-136 records.
//
// Same shape as ../../budget-variance/export/route.ts, which this generalises;
// that route stays as the Cost Variance screen's own path so its callers are
// untouched.
const FORMATS = new Set(["pdf", "xlsx", "csv"]);

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { reportName } = await params;
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
    const res = await callVeridianRaw(`/reports/${encodeURIComponent(reportName)}/export?${upstream.toString()}`, {
      organizationId: ctx.organizationId!,
    });
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? CONTENT_TYPE[format],
        "Content-Disposition": res.headers.get("content-disposition") ?? `attachment; filename="${reportName}.${format}"`,
      },
    });
  } catch (err) {
    // VERIDIAN answers a report with no schema in words ("The X report has no
    // document export yet..."); that sentence is passed through unchanged
    // rather than replaced with a generic apology.
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : `Failed to export the ${reportName} report` },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
