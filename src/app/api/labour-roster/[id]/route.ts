import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): single-roster-entry GET/PATCH for
// the Roster Object Page. Same root:true path as ../route.ts's own
// GET/POST -- labour-roster was never re-exported under /projexa/*.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/labour-roster/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load worker" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/labour-roster/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update worker" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
