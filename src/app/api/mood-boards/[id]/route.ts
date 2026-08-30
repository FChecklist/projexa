import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// Real-screen conversion (2026-08-30): single-board GET for the Mood Board
// Object Page.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/mood-boards/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load mood board" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

// Real-screen conversion (2026-08-30) bug fix: this used to unconditionally
// inject `action: "status"` into every PATCH body, which silently broke any
// details-update call (title/roomOrArea/description) -- the v1 route would
// take the status branch and fail on a missing `status` field instead. The
// body is now passed through unmodified; callers include `action: "status"`
// themselves when that's what they mean (see MoodBoardObjectClient.tsx).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/mood-boards/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update mood board" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/mood-boards/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to add mood board item" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
