import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 15: VERIDIAN's /api/v1/projexa/trial-balance report.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/trial-balance${request.nextUrl.search}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to generate trial balance");
  }
});
