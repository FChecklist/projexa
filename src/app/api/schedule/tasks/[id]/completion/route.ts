import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-49, rec R-125): one activity's completion provenance
// (GET) and the explicit manual override (PATCH).
//
// Separate from the sibling /api/schedule/tasks/[id] PATCH on purpose --
// VERIDIAN keeps them separate for a real reason (the override REQUIRES a
// note, enforced server-side), and collapsing them here would put the one
// endpoint that enforces that rule behind one that does not.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/schedule/${encodeURIComponent(id)}/completion`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load this activity's progress source" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/schedule/${encodeURIComponent(id)}/completion`, {
      organizationId: ctx.organizationId!, method: "PATCH", body,
    });
    return NextResponse.json(data);
  } catch (err) {
    // The backend's own sentence -- including "A note is required when you set
    // the percentage manually", which is the whole point of this route.
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to set this activity's completion" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
