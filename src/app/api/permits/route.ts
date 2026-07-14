import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 13 (Permits as a first-class module): VERIDIAN's
// /api/v1/projexa/permits -- the Bearer-key-reachable twin of VERIDIAN's own
// cookie-only /api/documents/expiring?category=permit, so PROJEXA can show a
// permit-expiry list without a cookie session.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const withinDays = request.nextUrl.searchParams.get("withinDays");
  const params = withinDays ? `?withinDays=${encodeURIComponent(withinDays)}` : "";
  try {
    const data = await callVeridian(`/permits${params}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load permits" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
