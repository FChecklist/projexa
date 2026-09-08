import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// Real-screen conversion (2026-08-30): single-PO GET for the Purchase
// Order Object Page.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/procurement/purchase-orders/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load purchase order");
  }
});

// R80 GAP-6: this route was GET-only, so a purchase order could never be
// edited or withdrawn from any layer of either codebase. Both handlers are
// thin proxies in the same shape as /api/quotations/[id]'s PATCH -- the
// draft-only + no-goods-receipts rule lives once, upstream, on
// updatePurchaseOrder()/cancelPurchaseOrder() in erp-buying-service.ts, and
// its 409 travels back through veridianErrorResponse() with the backend's own
// sentence (C19 ERROR_TRUTHFUL).
//
// The ROLE gate is middleware's, not this file's: PM_OR_ABOVE via
// API_WRITE_POLICY["/procurement/purchase-orders/[id]"], the same choke point
// every other mutating route in this repo goes through. The ORG gate is
// requireAuth()'s organizationId, which is what resolves the per-tenant
// VERIDIAN key -- a call with no credentials row fails loud rather than
// falling back to the shared key (AR-04).
export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/procurement/purchase-orders/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update purchase order");
  }
});

// DELETE is a CANCEL upstream (status -> 'cancelled'), never a row delete --
// the same "real Delete = real Cancel" convention InvoiceObjectClient and
// BudgetObjectClient already use.
export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/procurement/purchase-orders/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to cancel purchase order");
  }
});
