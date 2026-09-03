import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

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
export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}/approve`, {
      organizationId: ctx.organizationId!,
      // R67 WS-H (D-05): the acting user rides as a header so VERIDIAN can
      // refuse self-approval against a real person rather than an API key.
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
      method: "POST",
      body: {},
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to approve time entry");
  }
});
