import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C04: was missing entirely -- VERIDIAN's own addMeetingActionItem
// (Wave 143) had no PROJEXA-facing route until this one. Same relay
// pattern as the sibling moms/[id]/pdf route.
export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json();
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/action-items`, {
      method: "POST", body, organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to add action item");
  }
});
