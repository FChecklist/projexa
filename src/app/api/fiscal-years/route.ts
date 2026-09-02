import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createCachedVeridianGet } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Priority 13: VERIDIAN's /api/v1/projexa/fiscal-years discovery lookup --
// closes the gap PROJEXA_GAP_ANALYSIS.md flagged (Budgets page could not
// look up a real fiscalYearId before this).
//
// Perf, 2026-08-27: a fiscal-year list (id/date-range lookup data for the
// Budgets page) is set up once per org and almost never changes day to day
// -- not a live figure itself. GET-only route, so caching can't hide a
// write. Cached 60s, org-scoped -- see the security comment on
// createCachedVeridianGet() in veridian-client.ts for why that's safe.
const getCachedFiscalYears = createCachedVeridianGet("veridian-fiscal-years", "/fiscal-years", 60);

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await getCachedFiscalYears(ctx.organizationId!);
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load fiscal years");
  }
}
