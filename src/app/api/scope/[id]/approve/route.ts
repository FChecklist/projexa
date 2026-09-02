import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Real-screen conversion (2026-08-30) -- see the sibling submit/route.ts's
// own comment. Manager-role gating happens server-side in VERIDIAN
// (requireRoleOrScope) -- a non-manager's real backend error message is
// surfaced to the screen verbatim, not guessed at client-side.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/approve`, {
      organizationId: ctx.organizationId!, method: "POST",
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to approve BOQ");
  }
}
