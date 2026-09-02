import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 D-25: byte-for-byte relay of the BOQ import template spreadsheet, which
// VERIDIAN builds (src/app/api/v1/projexa/scope/import/template/route.ts).
// Same pattern as the Work Progress Report PDF relay in
// src/app/api/work-progress/report/pdf/route.ts: PROJEXA has no XLSX library
// of its own and must not gain one.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const upstream = await callVeridianRaw("/scope/import/template", { organizationId: ctx.organizationId! });
    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? 'attachment; filename="boq-import-template.xlsx"',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to download the BOQ import template" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
