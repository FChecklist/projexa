import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const data = await callVeridian(`/knowledge-base/search?q=${encodeURIComponent(q)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to search knowledge base" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
