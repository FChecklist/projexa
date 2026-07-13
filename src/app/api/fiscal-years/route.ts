import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 13: VERIDIAN's /api/v1/projexa/fiscal-years discovery lookup --
// closes the gap PROJEXA_GAP_ANALYSIS.md flagged (Budgets page could not
// look up a real fiscalYearId before this).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/fiscal-years");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load fiscal years" }, { status: 502 });
  }
}
