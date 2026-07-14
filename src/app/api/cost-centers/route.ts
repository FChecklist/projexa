import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 13: VERIDIAN's /api/v1/projexa/cost-centers discovery lookup --
// same rationale as the sibling fiscal-years/route.ts.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/cost-centers", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load cost centers" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
