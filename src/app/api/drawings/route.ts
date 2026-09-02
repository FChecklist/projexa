import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

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
  try {
    const data = await callVeridian(`/drawings?${forward.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load drawings");
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
    return veridianErrorResponse(err, "Failed to create drawing");
  }
}
