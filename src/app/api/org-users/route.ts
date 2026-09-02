import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-19: the org directory behind the MoM action-item people picker, which
// replaced "paste a known VERIDIAN user ID". Thin proxy over VERIDIAN's
// /api/v1/projexa/users -- that route reuses hr-service's existing users read
// path and returns id/name/email/role only, never the full employee record.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const q = request.nextUrl.searchParams.get("q");
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  try {
    const data = await callVeridian(`/users${params}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load the organisation's people" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
