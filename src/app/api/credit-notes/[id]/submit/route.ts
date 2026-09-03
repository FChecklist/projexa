import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): VERIDIAN's
// /api/v1/projexa/credit-notes/[id]/submit -- draft -> submitted, no body.
export const POST = withTiming("POST", async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/credit-notes/${id}/submit`, { organizationId: ctx.organizationId!, method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit credit note");
  }
});
