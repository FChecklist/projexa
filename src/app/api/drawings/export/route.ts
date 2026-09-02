import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// R67 D-10: byte-for-byte XLSX relay for the drawings register. Same pattern
// as src/app/api/work-progress/report/pdf/route.ts -- PROJEXA has no XLSX
// library of its own and must not gain one; VERIDIAN builds the workbook with
// the same rowsToXLSXBuffer() the reporting API uses (formula-injection guard
// included), and this route only carries the bytes and the filename across.
//
// The filters are forwarded unchanged so the exported register is exactly the
// register on screen -- an Export that quietly exported something else would be
// worse than no Export at all.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const forward = new URLSearchParams({ projectId });
  const kind = searchParams.get("kind");
  if (kind) forward.set("kind", kind);
  const discipline = searchParams.get("discipline");
  if (discipline) forward.set("discipline", discipline);

  try {
    const upstream = await callVeridianRaw(`/drawings/export?${forward.toString()}`, { organizationId: ctx.organizationId! });
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          upstream.headers.get("Content-Disposition") ?? `attachment; filename="drawings-${projectId}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to export the drawings register" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
