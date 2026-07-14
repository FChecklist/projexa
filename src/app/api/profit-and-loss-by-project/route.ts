import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 15: VERIDIAN's /api/v1/projexa/profit-and-loss-by-project --
// per-project (cost-center) revenue/expense rollup, the 500-project-scale
// view company-wide P&L alone doesn't answer.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/profit-and-loss-by-project${request.nextUrl.search}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to generate per-project P&L" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
