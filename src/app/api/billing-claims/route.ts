import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement #3/#7 ("billing milestones" / "... billing ... analysis"):
// VERIDIAN's constructionProgressClaims state machine already existed
// (construction-billing-workflow-service.ts) with no PROJEXA-reachable
// route. GET (?all=true) lists the FULL billing-milestones history for the
// new /billing-milestones screen; without it, the billing-due queue
// Project 360 Analysis's summary tile already used. POST creates a new
// billing milestone (progress claim).
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const all = request.nextUrl.searchParams.get("all");
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (all) params.set("all", all);
  try {
    const data = await callVeridian(`/billing-claims?${params.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load billing claims");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  // GUARDRAIL CHANGE -- same explicit Owner sign-off as [id]/route.ts's PATCH
  // (chat, 2026-09-19): member (acting as Finance) may create a new billing
  // milestone -- "draft/submit/invoice" per the Owner's own Merge 6 role
  // spec -- since drafting one starts here, not only at the PATCH
  // transition. client_viewer never creates one (they only decide on an
  // existing Submitted claim), so they still fall through to PM_OR_ABOVE
  // and are correctly refused.
  if (ctx.role !== "member") {
    const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
    if (roleError) return roleError;
  }
  const body = await request.json();
  try {
    const data = await callVeridian("/billing-claims", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create billing milestone");
  }
});
