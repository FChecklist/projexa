import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R42 seq21/22: the Bearer-key-reachable twin of VERIDIAN's new
// /api/v1/projexa/permits/[id] -- no detail route existed at all until now
// (confirmed live via screen_spec's own PERMITS.OBJECT row).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/permits/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load permit" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json();
    // R42 seq21 fix: only needed when body.draftId is present (VERIDIAN only
    // resolves an acting user then, to discard the draft) -- see
    // screen-drafts/route.ts's own comment for the full shared-API-key story.
    const data = await callVeridian(`/permits/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body: { ...body, actorEmail: ctx.user?.email ?? null } });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update permit" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/permits/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to delete permit" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
