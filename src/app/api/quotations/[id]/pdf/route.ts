import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

// Priority 15, Wave 2: streams the real generated PDF from VERIDIAN's
// /api/v1/projexa/quotations/[id]/pdf straight through -- PROJEXA has no PDF
// library of its own and shouldn't gain one (same zero-duplication principle
// as every other route in this file), so this is a byte-for-byte relay, not
// a re-render. callVeridian() (the normal helper) always calls res.json(),
// which would throw on a real binary body -- callVeridianRaw() returns the
// raw Response so the PDF bytes and headers can be forwarded untouched.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const upstream = await callVeridianRaw(`/quotations/${id}/pdf`, { organizationId: ctx.organizationId! });
    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? `attachment; filename="quotation-${id}.pdf"`,
      },
    });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to generate quotation PDF");
  }
}
