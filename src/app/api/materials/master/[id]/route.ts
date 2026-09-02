import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Real-screen conversion (2026-08-30): single-material GET/PATCH for the
// Material Object Page. Same root:true path as ../route.ts's own GET/POST.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/materials/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load material");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/construction/materials/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update material");
  }
}
