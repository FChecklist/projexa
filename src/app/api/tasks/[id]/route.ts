import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 F-26 (audit recommendation R-242) -- ONE task, by id.
//
// WHY. After a Send, M24Shell re-read /api/tasks?limit=50 to discover the row
// it had just created -- 590-1740 ms during which the composer was empty and
// Send was disabled with nothing on screen to look at. The minted row now goes
// straight into the pane from the POST response, and this endpoint is polled
// (1 s for ten seconds, then 5 s) until that ONE row reaches a terminal status.
// One row, only while something is running, instead of fifty on a timer.
export const dynamic = "force-dynamic";

export const GET = withTiming("GET", async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "A task id is required" }, { status: 400 });

  try {
    const data = await callVeridian(`/tasks/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    // The backend's OWN words, never a generic failure -- a poller that
    // reports "something went wrong" leaves the row spinning with no reason.
    return veridianErrorResponse(err, "Failed to load the task");
  }
});
