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
    // run against this machine's current load), RAISED A THIRD TIME
    // (2026-09-20, e2e-env1 CI investigation): getProjectExceptions() runs
    // its 24 detector functions sequentially, not via Promise.all
    // (construction-exceptions-service.ts's own header, matching
    // boq-analysis-service.ts's pool-contention reasoning) -- a deliberate,
    // correct choice for a 5-connection pool. The first pass here measured
    // ~8s and raised the budget to 20s; a same-day follow-up measured a
    // consistent ~20.0s under that session's machine load and raised it to
    // 35s. This is now the THIRD time this exact budget has been raised
    // and lost the race anyway -- compliance-tracker's e2e-env1 CI job
    // (2 real runs, 2026-09-20) captured the actual server-side proof this
    // time, not just a client-side timeout: ct-server.log's own structured
    // log line reads `{"route":"/exceptions",...,"status":503,
    // "upstreamMs":35001...}` -- the call was still genuinely in flight
    // and would very plausibly have succeeded seconds later, this was not
    // a hung/dead request. Raised with real margin this time (60s, not
    // another near-exact-tie bump) specifically so this stops being a
    // recurring "just a little more" chase. If this budget is ever lost
    // again, the real fix is very likely no longer "raise the number" --
    // it's parallelizing a subset of the 24 detectors (the ones that don't
    // share the pool-contention risk the sequential design exists to
    // avoid) or paginating/streaming the response, not a fourth bump.
    const data = await callVeridian(`/exceptions?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: ctx.organizationId!,
      timeoutMs: 60_000,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the exceptions report");
  }
});
