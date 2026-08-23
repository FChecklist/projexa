import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C04: was missing entirely -- VERIDIAN's own addMeetingActionItem
// (Wave 143) had no PROJEXA-facing route until this one. Same relay
// pattern as the sibling moms/[id]/pdf route.
export async function POST(request: NextRequest, { params }: RouteContext) {
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
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to add action item" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
