import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json();
    // R42 seq21 fix: see screen-drafts/route.ts's own comment -- same
    // shared-API-key -> actorEmail requirement.
    const data = await callVeridian(`/screen-drafts/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body: { ...body, actorEmail: ctx.user?.email ?? null } });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to autosave draft");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/screen-drafts/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE", body: { actorEmail: ctx.user?.email ?? null } });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to discard draft");
  }
});
