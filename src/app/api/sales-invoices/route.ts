import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 13: VERIDIAN's /api/v1/projexa/sales-invoices -- closes the
// Dashboard Revenue gap PROJEXA_GAP_ANALYSIS.md flagged (Total Revenue
// showed a hardcoded ₹0 disclosure because there was no self-serve API to
// create or link an ERP sales invoice from PROJEXA).
//
// Priority 15: GET now forwards its query string (status/customerId/
// fromDate/toDate/page/limit) to VERIDIAN's paginated/filtered list --
// full invoice lifecycle at 500-project scale needs more than a flat array.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/sales-invoices${request.nextUrl.search}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load sales invoices" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/sales-invoices", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create sales invoice" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
