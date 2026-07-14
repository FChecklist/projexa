import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 15: VERIDIAN's /api/v1/projexa/sales-invoices/[id]/cancel --
// draft invoices only (a submitted one needs a reversing credit note).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/sales-invoices/${id}/cancel`, { method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to cancel invoice" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
