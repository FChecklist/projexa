import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 WS-H (items H-01/H-03): "Submit today (4 rows, 7.50 h)" / "Submit day
// for review". Proxies to VERIDIAN's own submit-day route, which moves the
// whole day in ONE transaction -- deliberately not a client-side loop over
// /timesheets/[id]/submit, which can half-succeed and leave the designer
// with a day that is neither submitted nor not.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json().catch(() => ({}));
  if (!body.projectId || !body.spentOn) {
    return NextResponse.json({ error: "projectId and spentOn are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/timesheets/submit-day", {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      method: "POST",
      body: { projectId: body.projectId, spentOn: body.spentOn, actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to submit the day for review" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
