import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 16 Part 2 (PROJEXA-WORKPROGRESS-NO-ACTIVITY-PICKER): proxies to
// the new VERIDIAN /api/v1/projexa/work-progress/activities route (GET list
// + POST create) so the "Log Progress" dialog can offer a real activity
// picker instead of a free-text "paste the ID" box.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/work-progress/activities?projectId=${encodeURIComponent(projectId)}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load activities" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.projectId || !body.name) {
    return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/work-progress/activities", { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create activity" }, { status: 502 });
  }
}
