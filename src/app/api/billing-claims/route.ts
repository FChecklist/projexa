import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement #3/#7 ("billing milestones" / "... billing ... analysis"):
// VERIDIAN's constructionProgressClaims state machine already existed
// (construction-billing-workflow-service.ts) with no PROJEXA-reachable
// route. GET-only read of the billing-due queue for the Project 360 view.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  try {
    const data = await callVeridian(
      `/billing-claims${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { organizationId: ctx.organizationId! }
    );
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load billing claims");
  }
});
