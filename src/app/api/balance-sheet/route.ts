import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 15: VERIDIAN's /api/v1/projexa/balance-sheet report.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/balance-sheet${request.nextUrl.search}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to generate balance sheet" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
