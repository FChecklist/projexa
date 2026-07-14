import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;

  try {
    const data = await callVeridian(`/schedule/baselines/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to load baseline comparison";
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
