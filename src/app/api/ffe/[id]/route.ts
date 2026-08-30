import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// Real-screen conversion (2026-08-30): the FF&E schedule never had a detail
// route -- proxies to VERIDIAN's new GET on /v1/projexa/ffe/[id].
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/ffe/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load FF&E item" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/ffe/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body: { action: "status", ...body } });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update FF&E item" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
