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

// R67 D-47: an ACTIVITY, not just a titled issue. startDate / durationDays /
// predecessorId / boqLineItemId are forwarded to createScheduleActivity() on
// the VERIDIAN side, which validates the two ids against the org and derives the
// finish date from the duration. startDate is checked here too
// so the form gets the same refusal without a round trip -- a programme
// activity with no start cannot be drawn on a timeline, cannot have a
// duration, and cannot be compared to a baseline.
const ACTIVITY_FIELDS = ["startDate", "durationDays", "predecessorId", "boqLineItemId"] as const;

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.projectId || !body.title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }
  if (!body.startDate) {
    return NextResponse.json({ error: "startDate is required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/schedule", {
      organizationId: ctx.organizationId!,
      method: "POST",
      // Explicit rather than a bare spread, so a field this proxy does not know
      // about cannot reach the write path unreviewed.
      body: {
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        typeId: body.typeId,
        priority: body.priority,
        statusId: body.statusId,
        dueDate: body.dueDate,
        ...Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f, body[f]])),
      },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create task" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
