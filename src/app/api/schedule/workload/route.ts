import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  try {
    const data = await callVeridian(`/schedule/workload?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load workload from VERIDIAN");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  if (!body.projectId || !body.userId || !body.allocatedHoursPerDay || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "projectId, userId, allocatedHoursPerDay, startDate, endDate are required" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/schedule/workload", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create resource allocation");
  }
});
