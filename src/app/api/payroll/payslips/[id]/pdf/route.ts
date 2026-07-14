import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianBinary, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// Priority 15 Wave 2: streams VERIDIAN's generated payslip PDF straight
// through to the browser -- uses callVeridianBinary() (not callVeridian(),
// which assumes a JSON response body) since this is the first binary
// download PROJEXA proxies.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const { body, contentType } = await callVeridianBinary(`/payroll/payslips/${encodeURIComponent(id)}/pdf`);
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="payslip-${id}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to generate payslip PDF" }, { status: 502 });
  }
}
