import { NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement #3 continued -- a billing milestone's status
// transitions (draft/submit/approve/reject/invoice) and its document-flow
// timeline (claim -> interim bill -> sales invoice -> payment).
export const GET = withTiming("GET", async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/billing-claims/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the billing milestone's timeline");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  // GUARDRAIL CHANGE -- explicit Owner sign-off, quoted verbatim (chat,
  // 2026-09-19): "Fix the billing milestones authz gap ... Billing
  // Milestones contradicts your own Merge 6 spec: the UI shows live
  // Approve/Reject controls to client_viewer and Draft/Submit to member,
  // but the API gate (PM_OR_ABOVE) always 403s both ... Say the word and
  // I'll apply it." -- narrows (does not remove) the PM_OR_ABOVE gate to
  // match the Owner's own original Merge 6 role spec exactly: "member w/
  // cost-visibility (acts as Finance): Billing (draft/submit/invoice, not
  // decide)" and "client_viewer: Billing Milestones (approve/reject at
  // Submitted only)". So: member may reach draft/submit/invoice but NOT
  // approve/reject (they don't decide); client_viewer may reach
  // approve/reject but NOT draft/submit/invoice. owner/admin/pm keep every
  // action via PM_OR_ABOVE, unchanged. The upstream compliance-tracker
  // route enforces this same PATCH via the shared per-org API key's own
  // "write" scope, not per-user role, for every PROJEXA-proxied call
  // regardless of caller -- so this proxy-side check is the only place a
  // per-user role actually gates this transition.
  const FINANCE_ACTIONS = new Set(["draft", "submit", "invoice"]);
  const DECIDE_ACTIONS = new Set(["approve", "reject"]);
  const action = typeof body?.action === "string" ? body.action : undefined;
  const isMemberFinanceAction = ctx.role === "member" && action !== undefined && FINANCE_ACTIONS.has(action);
  const isClientDecideAction = ctx.role === "client_viewer" && action !== undefined && DECIDE_ACTIONS.has(action);
  if (!isMemberFinanceAction && !isClientDecideAction) {
    const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
    if (roleError) return roleError;
  }
  try {
    const data = await callVeridian(`/billing-claims/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update the billing milestone");
  }
});
