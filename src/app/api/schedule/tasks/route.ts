import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 16 Part 2 (PROJEXA-SCHEDULE-NO-CREATE-UI): proxies to the new
// VERIDIAN /api/v1/projexa/schedule route (POST -> createIssue()). Board
// view already covers listing/moving tasks via /api/board; this route
// exists specifically so the new "New Task" dialog has somewhere to POST.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/schedule?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load tasks" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.projectId || !body.title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/schedule", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create task" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
