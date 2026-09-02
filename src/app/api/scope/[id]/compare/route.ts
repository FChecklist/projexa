import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const against = request.nextUrl.searchParams.get("against");
  const query = against ? `?against=${encodeURIComponent(against)}` : "";
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/compare${query}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to compare scope revisions");
  }
}
