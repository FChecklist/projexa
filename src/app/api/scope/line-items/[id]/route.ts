import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// R39/R-C09: proxies to the new VERIDIAN /scope/line-items/[id] PATCH route
// so the BOQ view's budget/vendor overlay has somewhere to save to.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/scope/line-items/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update line item budget");
  }
}
