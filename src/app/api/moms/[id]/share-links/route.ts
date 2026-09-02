import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C04: was missing entirely -- VERIDIAN's own createMeetingShareLink
// (Wave 44) had no PROJEXA-facing route until this one. Reuses the SAME
// share-link mechanism the R-C15 fix (compliance-tracker#1331) proved
// working -- not a second share path.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/share-links`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load share links");
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/share-links`, {
      method: "POST", organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create share link");
  }
}
