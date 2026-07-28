import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Construction material catalog lives at VERIDIAN's /api/v1/construction/materials
// -- never re-exported under /api/v1/projexa/*, matching labour-roster's own
// root:true precedent (see that route's own comment).

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load materials" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/materials", { organizationId: ctx.organizationId!, method: "POST", body, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to add material" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
