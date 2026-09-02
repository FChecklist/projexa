import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

// Wave 143: same byte-for-byte relay pattern as quotations/[id]/pdf --
// PROJEXA has no PDF library of its own; VERIDIAN generates the real PDF.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const upstream = await callVeridianRaw(`/veri-meetings/${encodeURIComponent(id)}/pdf`, { organizationId: ctx.organizationId! });
    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? `attachment; filename="mom-${id}.pdf"`,
      },
    });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to generate meeting PDF");
  }
}
