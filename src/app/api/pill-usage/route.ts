import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R52: PROJEXA's proxy to VERIDIAN's pill ranking + M24 history.
// Contract from R53's handshake, claude_log id=35.
//
// *** THE PILLS COME BACK ALREADY RANKED. RENDER IN ORDER. DO NOT RE-SORT. ***
// The ranking is MP-RULE-3 and it is a QUERY on the server, not a stored
// number: pinned first at any age, then inside the rolling 7-day window by
// use_count, then OUTSIDE the window by last-used-ever to fill the remaining
// slots. That third tier is MP-RISK-3 -- without it a month-end job used
// heavily on the 30th is invisible from the 8th.
//
// Each pill carries `tier`: "pinned" | "window" | "last_used_ever", so if an
// order ever looks wrong it says WHICH RULE produced it without needing a
// reproduction. The kit's own rankPills() stays as the offline fallback for
// when this call fails; it implements the same three tiers and is unit-tested,
// but the server's order wins whenever the server answers.
//
// `history` INCLUDES FAILED CHAINS (outcome:"failed"). Do not filter them out:
// M24 is explicit that "the commonest reason to re-run something is that it
// went wrong."
//
// `isNewUser: true` means the arrays are empty BECAUSE nothing is earned yet,
// not because the call failed. Those two look identical on screen and must not
// be -- M24: empty states must prompt, never look broken.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams();
  for (const k of ["limit", "historyLimit"]) {
    const v = searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  try {
    const data = await callVeridian(`/pill-usage${suffix}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load pill usage" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

// R67 A-07 -- POST: record ONE card click.
//
// Until now the composer counted card clicks in the browser's own
// localStorage and nowhere else, so the server ranked only from rows the
// PIPELINE had written -- and most card clicks NAVIGATE rather than execute,
// which meant the ranking could never learn what a user actually does. A
// site engineer who opens "Record progress" forty times a week saw it ranked
// by nothing at all.
//
// *** RECORDING IS NOT RUNNING. *** The body carries a pillKey, an optional
// functionId and the chain the user built; VERIDIAN's own handler upserts one
// compliance.pill_usage row and returns. There is no dispatch on this path.
export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/pill-usage", {
      method: "POST",
      body,
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    // The backend's own words. A failed ranking write must never be shown to
    // the user as a failed CLICK: the caller ignores this response entirely,
    // because the navigation the click performed has already happened.
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to record pill usage" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
