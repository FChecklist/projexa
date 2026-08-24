import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R42 seq21/22: the generic draft-lifecycle proxy (M29) -- module-agnostic,
// any function_id can start/resume a draft through this one route.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const functionId = searchParams.get("functionId");
  const objectId = searchParams.get("objectId");
  if (!functionId) return NextResponse.json({ error: "functionId is required" }, { status: 400 });
  const qs = new URLSearchParams({ functionId, ...(objectId ? { objectId } : {}) });
  try {
    const data = await callVeridian(`/screen-drafts?${qs.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load draft" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const body = await request.json();
    const data = await callVeridian("/screen-drafts", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to start draft" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
