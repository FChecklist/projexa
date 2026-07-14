import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 13: VERIDIAN's /api/v1/projexa/customers discovery lookup -- the
// customerId a sales invoice needs, same shape of gap fiscal-years/
// cost-centers close for budgets.
// Priority 15 (Sales & CRM depth wave): forwards search/page/pageSize query
// params through to VERIDIAN's listCustomersPaged variant, and adds POST
// so PROJEXA's own Customers page can create a customer directly (CRM/
// quotation/sales-order flows all need a real customerId to pick from).
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const qs = request.nextUrl.search;
  try {
    const data = await callVeridian(`/customers${qs}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load customers" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/customers", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create customer" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
