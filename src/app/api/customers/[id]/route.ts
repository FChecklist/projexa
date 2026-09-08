import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): single-customer GET/PATCH for the
// Customer Object Page's Edit/Deactivate actions.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/customers/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load customer");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/customers/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update customer");
  }
});

// R80 GAP-14: the Customer Object Page carried Edit but no Delete at ANY
// layer -- no DELETE here, and no onDelete on CustomerOverviewClient. This is
// that missing verb, and it is a SOFT delete on purpose.
//
// *** WHY IT IS NOT A HARD DELETE, AND WHY THERE IS NO 409. *** VERIDIAN
// exposes no deleteCustomer at all -- erp-selling-service.ts exports
// listCustomers, listCustomersPaged, createCustomer, getCustomer,
// updateCustomer and getCustomerOverview, and no delete of any shape (an
// earlier draft said "list/create/get/update and nothing else", which
// undersold the read side) -- and that absence is the right shape rather
// than a gap to route around: an erp_customers row is referenced
// by opportunities, quotations, sales orders and sales invoices, so destroying
// it would orphan every one of them. Retiring the row instead means the delete
// CANNOT reach a broken state whatever the customer's history looks like,
// which is why this makes no dependent-count probe and never refuses: there is
// nothing left to refuse.
//
// SOFT DELETE IS NOT THIS REPO'S NORM, and an earlier draft of this comment
// wrongly said it was. It cited three precedents and only ONE is real:
// /api/org/invites/[id]'s DELETE writes revoked_at (a genuine soft revoke).
// The other two do not exist -- /api/materials/[id] exports GET and PATCH
// only and its own header says there is "deliberately no DELETE", and
// /api/labour-roster/[id] exports only GET and PATCH too.
//
// THE CORRECTION TO THAT CORRECTION: a later draft overshot into "every
// OTHER DELETE handler in src/app/api is destructive", which contradicts the
// invites route named two lines up. Measured against the tree: nineteen
// route files under src/app/api export a DELETE and FOUR of them destroy
// nothing -- /api/org/invites/[id] (writes revoked_at),
// /api/procurement/purchase-orders/[id] (forwards to cancelPurchaseOrder(),
// status -> 'cancelled'), and this route and its /api/vendors/[id] twin
// (both PATCH isActive:false). Destroying is still the clear majority:
// /api/todos/[id] runs a real supabase .delete(), and drawings, moms,
// permits, scope, timesheets, work-progress and screen-drafts each forward
// method:"DELETE" straight through to VERIDIAN with no soft step of their
// own. So this handler is a deliberate exception justified by the orphaning
// above, not an established local convention -- do not copy it into a new
// route without making the same argument for that route.
//
// ORG SCOPING is identical to GET/PATCH above: requireAuth(), then the
// per-org VERIDIAN key resolveApiKey() derives from ctx.organizationId. Per
// AR-04 a request that names a tenant with no credentials row throws rather
// than falling back to the shared key, so this cannot cross tenants. The ROLE
// gate is deliberately NOT repeated in this file: middleware.ts runs
// checkApiWriteAccess() ahead of every mutating /api/* request, and
// "/customers/[id]" is already PM_OR_ABOVE in api-write-policy.ts -- a table
// keyed by PATH, not by method, so it covered this DELETE the moment it
// existed (see that file's "one table and one choke point" header).
export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/customers/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body: { isActive: false } });
    // `deactivated`, never `deleted`: the caller is told what actually
    // happened to the row rather than being left to infer a destruction that
    // did not occur. The updated customer travels with it so a screen can
    // re-render from the response instead of re-reading.
    //
    // DELIBERATELY IDEMPOTENT, and `deactivated: true` means "this customer
    // is now inactive", NOT "this call is what retired it". DELETE on an
    // already-inactive customer returns the same 200. That is chosen, not
    // overlooked: RFC 9110 defines DELETE as idempotent, and the alternative
    // -- the /api/org/invites/[id] shape, which filters on current state in
    // one SQL UPDATE and 404s when nothing matched -- is not reproducible
    // through this proxy. There is no conditional PATCH here, so it would
    // take a GET-then-PATCH whose gap two concurrent deactivations can slip
    // through anyway: a race that 404s a caller whose customer IS inactive,
    // traded for nothing. A caller that must distinguish the two reads
    // `customer.isActive` before calling, or diffs the returned record.
    return NextResponse.json({ deactivated: true, id, customer: data });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to deactivate customer");
  }
});
