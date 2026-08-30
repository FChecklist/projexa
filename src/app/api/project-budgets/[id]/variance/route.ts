import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

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
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to compute budget variance" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
