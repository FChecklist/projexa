import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C12: was missing entirely -- submitted->rejected had no PROJEXA route.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}/reject`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to reject time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
