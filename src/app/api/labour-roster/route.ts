import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Roster (workers) lives at VERIDIAN's /api/v1/construction/labour-roster --
// it was never re-exported under /api/v1/projexa/*, unlike attendance
// itself. See veridian-client.ts's `root` option for why this passes
// root: true instead of hitting the usual /projexa base.

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/labour-roster?projectId=${encodeURIComponent(projectId)}`, { root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load labour roster" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/labour-roster", { method: "POST", body, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to add worker" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
