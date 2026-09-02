import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// PROJEXA_GAP_ANALYSIS.md gap #5: thin passthrough to VERIDIAN's new
// GET /change-orders/[id]/signature-status alias (esignature-service.ts's
// listSignatureRequests(), filtered to this change order), same pattern as
// every other route in this directory.
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/change-orders/${encodeURIComponent(id)}/signature-status`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load signature status");
  }
});
