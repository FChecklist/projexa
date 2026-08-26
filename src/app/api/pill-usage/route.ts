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
