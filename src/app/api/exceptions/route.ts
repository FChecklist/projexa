import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet requirement (new, 2026-09-18): the 28-item deterministic exceptions
// report ("PROJEXA-AI.COM SHOULD BE ABLE TO CAPTURE, ANALYZE, FIX, ALL OF
// THESE"). GET-only -- this screen reports facts, it never writes anything.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    // REAL PERFORMANCE GAP FOUND (2026-09-19, Playwright gap-closure sweep):
    // getProjectExceptions() runs its 24 detector functions sequentially,
    // not via Promise.all (construction-exceptions-service.ts's own header,
    // matching boq-analysis-service.ts's pool-contention reasoning) -- a
    // deliberate, correct choice for a 5-connection pool, but it means the
    // real end-to-end call measures ~8s against the live database, right at
    // the default VERIDIAN_FETCH_TIMEOUT_MS edge, so ordinary network
    // jitter reproducibly timed this call out even on a genuinely
    // successful (200) backend response. Raised, not shortened elsewhere --
    // this route's own sequential-by-design cost is real and belongs to
    // this call site, not something to paper over by making the DB queries
    // themselves race each other on a small pool.
    const data = await callVeridian(`/exceptions?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: ctx.organizationId!,
      timeoutMs: 20_000,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the exceptions report");
  }
});
