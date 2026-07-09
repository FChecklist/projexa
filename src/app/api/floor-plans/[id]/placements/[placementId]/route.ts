import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string; placementId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, placementId } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, { method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update placement" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, placementId } = await params;
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, { method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to remove placement" }, { status: 502 });
  }
}
