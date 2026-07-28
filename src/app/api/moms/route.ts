import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Wave 143 (Minutes of Meeting module): proxies VERIDIAN's
// /api/v1/projexa/veri-meetings -- the real VERI Meeting Intelligence
// engine (live minutes, AI summary/action items, publish/lock), not
// PROJEXA's existing basic /api/meetings scheduling CRUD.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  try {
    const data = await callVeridian(`/veri-meetings${params}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load meetings" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const body = await request.json();
    const data = await callVeridian("/veri-meetings", { method: "POST", body, organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create meeting" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
