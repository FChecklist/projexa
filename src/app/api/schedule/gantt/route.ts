import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  try {
    const data = await callVeridian(`/schedule/gantt?projectId=${encodeURIComponent(projectId)}`);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to load schedule from VERIDIAN";
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
