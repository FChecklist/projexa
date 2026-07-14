import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 15: VERIDIAN's /api/v1/projexa/compliance-register -- the GRC
// risk/compliance register view (compliance-service.ts).
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/compliance-register${request.nextUrl.search}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load compliance register" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/compliance-register", { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create compliance register item" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
