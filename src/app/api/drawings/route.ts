import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// Wave 143 (Drawings & 3D module): proxy to VERIDIAN's
// /api/v1/projexa/drawings -- DWG file uploads and 3D walkthrough
// files/links, per project.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  const forward = new URLSearchParams({ projectId });
  const kind = searchParams.get("kind");
  if (kind) forward.set("kind", kind);
  // R67 D-10: the register's Filter offers Kind AND Discipline; both are
  // applied upstream so the count the screen shows is the count the backend
  // actually returned, not a second client-side narrowing on top of it.
  const discipline = searchParams.get("discipline");
  if (discipline) forward.set("discipline", discipline);
  try {
    const data = await callVeridian(`/drawings?${forward.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load drawings" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/drawings", formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create drawing" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
