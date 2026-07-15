import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// Priority 17 Wave 1: proxies to VERIDIAN /api/v1/projexa/schedule/sprints/[id]
// (updateSprint(); { action: "close" } triggers closeSprint()).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/schedule/sprints/${encodeURIComponent(id)}`, { method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update sprint" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
