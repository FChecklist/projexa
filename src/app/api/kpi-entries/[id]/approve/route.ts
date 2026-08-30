import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// KPI entries live at /api/v1/construction/kpi-entries (never re-exported
// under /projexa/*, same as ../route.ts's own GET/POST) -- approve follows
// the same root:true path.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/kpi-entries/${encodeURIComponent(id)}/approve`, { organizationId: ctx.organizationId!, method: "POST", root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to approve KPI entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
