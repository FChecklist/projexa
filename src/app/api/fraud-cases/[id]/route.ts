import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 15: VERIDIAN's /api/v1/projexa/fraud-cases/[id] -- case detail
// and status transitions.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/fraud-cases/${id}`, { method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update fraud case" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
