import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): single-vendor GET/PATCH for the
// Vendor Object Page.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load vendor");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update vendor");
  }
});

// R80 GAP-14: the Vendor Object Page carried Edit but no Delete at ANY layer.
// This is the missing verb, and -- like its /api/customers/[id] twin -- it is
// a SOFT delete, for the same two reasons.
//
// *** WHY IT IS NOT A HARD DELETE, AND WHY THERE IS NO 409. *** VERIDIAN has
// no deleteSupplier. erp-buying-service.ts carries listSuppliers,
// createSupplier, getSupplier and updateSupplier -- plus the scorecard reads
// and updateSupplierTaxWithholding, so an earlier draft's "and stops there"
// was wrong about the shape while right about the point: there is no delete
// of any kind. Good, because an erp_suppliers row is pointed at by purchase
// orders, RFQs, goods receipts, its own bank accounts, qualification reviews,
// sanction checks and portal links, AND by construction BOQ line items
// (constructionBoqLineItems.vendorId -- see ScopeObjectClient's per-line
// vendor Select). Destroying it would orphan all of those; retiring it cannot
// reach a broken state at all, so this route needs no dependent probe and has
// nothing to refuse.
//
// SOFT DELETE IS NOT THIS REPO'S NORM. An earlier draft of this comment
// claimed the same posture as /api/materials/[id], /api/labour-roster/[id]
// and /api/org/invites/[id]; only the last is real. /api/materials/[id]
// exports GET and PATCH only (its header: "deliberately no DELETE"), and
// /api/labour-roster/[id] likewise exports only GET and PATCH -- neither has
// a DELETE to be soft. That draft was then over-corrected into "every other
// DELETE in src/app/api is destructive", which is also untrue: of the
// nineteen route files exporting a DELETE, four destroy nothing -- the
// invites route above, /api/procurement/purchase-orders/[id] (forwards to
// cancelPurchaseOrder()), and this route and its /api/customers/[id] twin.
// Destroying is the clear majority, not a universal rule: /api/todos/[id]
// runs supabase .delete() and drawings, moms, permits, scope, timesheets,
// work-progress and screen-drafts forward method:"DELETE" straight through
// with no soft step (the /api/customers/[id] header carries the full
// accounting). This route and that twin are deliberate exceptions earned by
// the orphaning argument above, not a convention to copy unexamined.
//
// ORG SCOPING matches GET/PATCH above -- requireAuth() plus the per-org
// VERIDIAN key derived from ctx.organizationId, which AR-04 forbids falling
// back to a shared key. The role gate is central rather than per-file:
// middleware.ts checks api-write-policy.ts ahead of every mutating /api/*
// request, and "/vendors/[id]" is already PM_OR_ABOVE there. That table is
// keyed by path, so it governs this DELETE without a new entry.
export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body: { isActive: false } });
    // `deactivated`, never `deleted` -- the response states what really
    // happened to the row, and carries the updated vendor so the screen can
    // re-render without a second read.
    //
    // DELIBERATELY IDEMPOTENT, exactly as in /api/customers/[id]:
    // `deactivated: true` asserts "this vendor is now inactive", not "this
    // call is what retired it", and a DELETE on an already-inactive vendor
    // returns the same 200. DELETE is idempotent by RFC 9110, and the
    // /api/org/invites/[id] alternative -- filter on current state inside one
    // UPDATE and 404 when nothing matched -- has no equivalent through this
    // proxy: there is no conditional PATCH, so it would take a GET-then-PATCH
    // whose window two concurrent deactivations race through regardless. A
    // caller that needs the distinction reads `vendor.isActive` first.
    return NextResponse.json({ deactivated: true, id, vendor: data });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to deactivate vendor");
  }
});
