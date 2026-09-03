import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// KPI entries live at /api/v1/construction/kpi-entries (never re-exported
// under /projexa/*, same as ../route.ts's own GET/POST) -- approve follows
// the same root:true path.
export const POST = withTiming("POST", async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/kpi-entries/${encodeURIComponent(id)}/approve`, { organizationId: ctx.organizationId!, method: "POST", root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to approve KPI entry");
  }
});
