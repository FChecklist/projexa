import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): the SAP VBFA "Display Document Flow"
// equivalent (SD-007, quotation -> sales order -> sales invoice(s) ->
// payment entries / credit notes / sales returns) has had a real, complete
// v1 route (getSalesOrderDocumentFlow) since it was built -- it just had no
// PROJEXA-facing proxy until now, so this real feature was completely
// unreachable from PROJEXA despite being fully built.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/sales-order-document-flow/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load document flow" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
