import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  try {
    const data = await callVeridian(`/schedule/workload?projectId=${encodeURIComponent(projectId)}`);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to load workload from VERIDIAN";
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  if (!body.projectId || !body.userId || !body.allocatedHoursPerDay || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "projectId, userId, allocatedHoursPerDay, startDate, endDate are required" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/schedule/workload", { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to create resource allocation";
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
