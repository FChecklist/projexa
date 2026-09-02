import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Priority 15: VERIDIAN's /api/v1/projexa/audit-findings/[id] -- advances
// the CAPA remediation status one step (open -> in_progress -> closed).
export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/audit-findings/${id}`, { organizationId: ctx.organizationId!, method: "PATCH" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update audit finding");
  }
}
