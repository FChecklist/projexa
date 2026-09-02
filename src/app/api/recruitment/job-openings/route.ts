import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

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
    return veridianErrorResponse(err, "Failed to load job openings");
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
    return veridianErrorResponse(err, "Failed to create job opening");
  }
}
