import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const asOfDate = request.nextUrl.searchParams.get("asOfDate");
  try {
    const qs = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : "";
    const data = await callVeridian(`/project-budgets/${encodeURIComponent(id)}/variance${qs}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to compute budget variance");
  }
}
