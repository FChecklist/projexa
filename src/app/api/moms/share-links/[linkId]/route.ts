import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ linkId: string }> };

// Real-screen conversion (2026-08-30): real Revoke for the MoM Object
// Page's share-links list -- VERIDIAN's own revokeMeetingShareLink() had no
// PROJEXA-reachable route until this one.
export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { linkId } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/share-links/${encodeURIComponent(linkId)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to revoke share link");
  }
});
