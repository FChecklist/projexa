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
    // REAL PERFORMANCE GAP FOUND (2026-09-19, Playwright gap-closure sweep),
    // BUDGET RAISED AGAIN SAME DAY (Merge 6 workspace embed, real browser
    // run against this machine's current load): getProjectExceptions() runs
    // its 24 detector functions sequentially, not via Promise.all
    // (construction-exceptions-service.ts's own header, matching
    // boq-analysis-service.ts's pool-contention reasoning) -- a deliberate,
    // correct choice for a 5-connection pool. The first pass here measured
    // ~8s and raised the budget to 20s; a real end-to-end browser run today
    // measured compliance-tracker's own server log completing the SAME call
    // in a consistent ~20.0s under this machine's current RAM pressure,
    // meaning 20s was no longer a real margin, just a near-exact tie the
    // call lost almost every time (confirmed via a direct fetch: 503
    // UPSTREAM_TIMEOUT at 20357ms). Raised again, not shortened elsewhere,
    // same reasoning as before: this call's sequential-by-design cost is
    // real and belongs here, not something to paper over upstream.
    const data = await callVeridian(`/exceptions?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: ctx.organizationId!,
      timeoutMs: 35_000,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the exceptions report");
  }
});
