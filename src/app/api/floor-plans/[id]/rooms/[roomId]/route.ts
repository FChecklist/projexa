import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string; roomId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, roomId } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/rooms/${encodeURIComponent(roomId)}`, { method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update room" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, roomId } = await params;
  try {
    const data = await callVeridian(`/floor-plans/${encodeURIComponent(id)}/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to remove room" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
