import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const { id } = await params;
    const data = await callVeridian(`/recruitment/interviews/${encodeURIComponent(id)}/feedback`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit interview feedback");
  }
}
