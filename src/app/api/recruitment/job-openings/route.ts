import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/recruitment/job-openings", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    // Priority 16 Part 2: real upstream status now surfaced instead of a
    // hardcoded 502 (already landed for this route via sibling PR #13,
    // "Fix: forward real upstream status codes instead of hardcoding 502" --
    // kept as-is here rather than duplicated).
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load job openings" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/recruitment/job-openings", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create job opening" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
