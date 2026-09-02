import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Priority 15: VERIDIAN's /api/v1/projexa/profit-and-loss-by-project --
// per-project (cost-center) revenue/expense rollup, the 500-project-scale
// view company-wide P&L alone doesn't answer.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/profit-and-loss-by-project${request.nextUrl.search}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to generate per-project P&L");
  }
}
