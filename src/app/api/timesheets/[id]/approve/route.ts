import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C12 (v5 D-10): was missing entirely -- submitted->approved had no
// PROJEXA route, so the demo's own approval-must-block requirement had no
// way to be exercised end-to-end from the product.
//
// R39/R-C12 fix-2 (live-oracle finding): same actorEmail forward as
// submit/route.ts -- see its header comment for the full evidence trail.
// Self-approval-block is still enforced VERIDIAN-side (a real resolved
// actorEmail user, not the shared API key) so this is not weaker than the
// session-only path it mirrors.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}/approve`, {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to approve time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
