import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { VeridianApiError, createCachedVeridianGet } from "@/lib/veridian-client";

// Priority 13: VERIDIAN's /api/v1/projexa/cost-centers discovery lookup --
// same rationale as the sibling fiscal-years/route.ts.
//
// Perf, 2026-08-27: a cost-center list (names/ids used to populate form
// dropdowns) is reference data an org sets up once and rarely edits -- not
// a live financial figure itself. GET-only route, so caching can't hide a
// write. Cached 60s, org-scoped -- see the security comment on
// createCachedVeridianGet() in veridian-client.ts for why that's safe.
const getCachedCostCenters = createCachedVeridianGet("veridian-cost-centers", "/cost-centers", 60);

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await getCachedCostCenters(ctx.organizationId!);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load cost centers" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
