import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 17 Wave 1: proxies to VERIDIAN /api/v1/projexa/timesheets
// (listTimeEntriesForProject/ForIssue via pms-time-service.ts, plus
// logTime()). Supports ?projectId=, ?issueId=, and ?mine=true (own
// timesheet only).
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const issueId = request.nextUrl.searchParams.get("issueId");
  const mine = request.nextUrl.searchParams.get("mine");
  if (!projectId && !issueId) return NextResponse.json({ error: "projectId or issueId query param is required" }, { status: 400 });
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  if (issueId) qs.set("issueId", issueId);
  if (mine) qs.set("mine", mine);
  try {
    const data = await callVeridian(`/timesheets?${qs.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load time entries" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

// R39/R-C12 fix-2: forward actorEmail so VERIDIAN can resolve a real acting
// user (this route was equally dead-on-arrival before that fix -- see
// timesheets/[id]/submit/route.ts's header comment for the full evidence
// trail; same root cause, predates R39).
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.issueId || !body.hours || !body.spentOn) {
    return NextResponse.json({ error: "issueId, hours, and spentOn are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/timesheets", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { ...body, actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to log time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
