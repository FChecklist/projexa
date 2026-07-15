import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 17 Wave 1: proxies to VERIDIAN /api/v1/projexa/knowledge-base
// (org-wide pages via knowledge-base-service.ts). No projectId -- this is
// deliberately not project-scoped, distinct from /api/wiki.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/knowledge-base");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load knowledge base pages" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  try {
    const data = await callVeridian("/knowledge-base", { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create knowledge base page" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
