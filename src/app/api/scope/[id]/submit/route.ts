import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Real-screen conversion (2026-08-30): the real Scope Object Page needs a
// real Submit-for-Approval action -- VERIDIAN's submitBoq() has always
// existed but was never exposed on the v1/projexa surface until this same
// pass (see compliance-tracker's api/v1/projexa/scope/[id]/submit/route.ts).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/submit`, {
      organizationId: ctx.organizationId!, method: "POST",
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit BOQ for approval");
  }
}
