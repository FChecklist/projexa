import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): the Schedule module's Board/Sprints/
// Timesheet all reference a task by id, but PROJEXA never had a single-task
// route -- only list+create (schedule/route.ts) and a statusId-only PATCH
// (board/route.ts, used by drag-and-drop). Proxies to VERIDIAN's new
// /v1/projexa/schedule/[id] (GET via getIssue, PATCH via updateIssue).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/schedule/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load task" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/schedule/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update task" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
