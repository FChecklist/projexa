import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/work-progress?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load work progress");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    // R42 seq22 fix: VERIDIAN authenticates this call with a shared per-org
    // API key -- forward this real session's own email so it can resolve
    // who's actually acting (recordedById), same actorEmail pattern the
    // timesheets/screen-drafts routes already use.
    const data = await callVeridian("/work-progress", { organizationId: ctx.organizationId!, method: "POST", body: { ...body, actorEmail: ctx.user?.email ?? null } });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to log progress");
  }
}
