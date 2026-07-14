import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/recruitment/job-openings/${encodeURIComponent(id)}/status`, { method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update job opening status" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
