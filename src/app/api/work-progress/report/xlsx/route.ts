import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 E-18 (R-178) / E-20 (R-208): byte-for-byte XLSX relay for the Work
// Progress Report.
//
// PROJEXA MUST NOT GAIN AN XLSX LIBRARY -- R-178's own words. VERIDIAN builds
// the bytes through report-export-shared.ts's rowsToXLSXBuffer, which carries
// the OWASP formula-injection guard (BOQ descriptions, categories and vendor
// names are user-typed free text and are exactly the fields that guard exists
// for), from the SAME ReportExportSchema and the SAME computeRows() its PDF is
// drawn from. So the spreadsheet, the PDF and the table on screen are three
// renderings of one description rather than three opinions.
//
// Deliberately the same shape as the sibling ../pdf/route.ts: same parameters,
// same normalisation of ?mode, same error passthrough.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // Default to "total" on anything that is not exactly "balance" -- the same
  // normalisation the upstream route does, so the two can never disagree.
  const mode = searchParams.get("mode") === "balance" ? "balance" : "total";
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 });

  const qs = `projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`;
  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  try {
    const upstream = await callVeridianRaw(`/work-progress/report/xlsx?${qs}`, { organizationId: ctx.organizationId! });
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? XLSX_TYPE,
        "Content-Disposition":
          upstream.headers.get("Content-Disposition") ??
          `attachment; filename="work-progress-report-${projectId}-${from}-to-${to}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate work progress report XLSX" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
