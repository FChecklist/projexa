import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): VERIDIAN's
// /api/v1/projexa/sales-invoices/[id]/submit -- posts the invoice's real GL
// entry (draft -> submitted). Requires a revenueAccountId in the body; see
// InvoiceObjectClient.tsx for the account picker.
export const POST = withTiming("POST", async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/sales-invoices/${id}/submit`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit invoice");
  }
});
