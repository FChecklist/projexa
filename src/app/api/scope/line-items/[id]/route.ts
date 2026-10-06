import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R39/R-C09: proxies to the new VERIDIAN /scope/line-items/[id] PATCH route
// so the BOQ view's budget/vendor overlay has somewhere to save to.
export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/scope/line-items/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
      // R85 Addendum 3 v4, Phase 2: the grid's own dual-view cell edits
      // (qtyProject/rateProject/qtyContract/rateContract) go through this
      // same route -- forwarding the real acting user is what lets
      // VERIDIAN's cost-visibility gate return this PROJEXA user's own
      // role-appropriate response instead of unconditionally redacting
      // every API-key call (see /api/scope/[id]/route.ts's own comment).
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    // G-14: a 409 from an edit that carried `expectedCategory` says what is stored NOW, so the person can choose between theirs and mine.
    const upstream = err instanceof VeridianApiError && err.status === 409 ? (err.body as { code?: unknown; current?: unknown } | undefined) : undefined;
    if (upstream?.code === "EDIT_CONFLICT" && upstream.current && typeof upstream.current === "object") {
      return veridianErrorResponse(err, "This line was changed by someone else.", undefined, { conflict: "EDIT_CONFLICT", current: upstream.current });
    }
    return veridianErrorResponse(err, "Failed to update line item budget");
  }
});
