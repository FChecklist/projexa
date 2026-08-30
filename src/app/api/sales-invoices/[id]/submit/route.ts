import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): VERIDIAN's
// /api/v1/projexa/sales-invoices/[id]/submit -- posts the invoice's real GL
// entry (draft -> submitted). Requires a revenueAccountId in the body; see
// InvoiceObjectClient.tsx for the account picker.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/sales-invoices/${id}/submit`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to submit invoice" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
