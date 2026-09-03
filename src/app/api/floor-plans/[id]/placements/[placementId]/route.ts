import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string; placementId: string }> };

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, placementId } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update placement");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, placementId } = await params;
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to remove placement");
  }
});
