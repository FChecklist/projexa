import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

// Real-screen conversion (2026-08-30): removeMoodBoardItem() had a working
// v1 route (DELETE) but no PROJEXA-facing proxy at all -- an item could be
// added but never removed from PROJEXA.
export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id, itemId } = await params;
  try {
    const data = await callVeridian(`/mood-boards/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to remove item");
  }
});
