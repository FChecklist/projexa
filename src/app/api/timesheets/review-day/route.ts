import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 WS-H (item H-03, "Approve (bulk per day)"): the manager's mirror of
// submit-day, and it exists for the same reason -- a client loop of N POSTs can
// half-succeed, and a half-decided day is worse on the reviewer's side than on
// the designer's, because it re-renders in a queue they believe they have
// already cleared. VERIDIAN's reviewDayForReview() moves the whole day in ONE
// transaction; self-review is still refused there, against a real person.
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => ({}));
  if (!body.designerId || !body.projectId || !body.spentOn || !body.decision) {
    return NextResponse.json({ error: "designerId, projectId, spentOn and decision are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/timesheets/review-day", {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
      method: "POST",
      body: {
        designerId: body.designerId,
        projectId: body.projectId,
        spentOn: body.spentOn,
        decision: body.decision,
        rejectionReason: body.rejectionReason,
      },
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to record the review decision");
  }
});
