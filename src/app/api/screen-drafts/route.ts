import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R42 seq21/22: the generic draft-lifecycle proxy (M29) -- module-agnostic,
// any function_id can start/resume a draft through this one route.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const functionId = searchParams.get("functionId");
  const objectId = searchParams.get("objectId");
  if (!functionId) return NextResponse.json({ error: "functionId is required" }, { status: 400 });
  const qs = new URLSearchParams({ functionId, ...(objectId ? { objectId } : {}) });
  try {
    const data = await callVeridian(`/screen-drafts?${qs.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load draft");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const body = await request.json();
    // R42 seq21 fix: VERIDIAN authenticates this call with a shared per-org
    // API key, so it needs this real session's own email to resolve who's
    // actually acting -- same actorEmail pattern the timesheets routes use.
    const data = await callVeridian("/screen-drafts", { organizationId: ctx.organizationId!, method: "POST", body: { ...body, actorEmail: ctx.user?.email ?? null } });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to start draft");
  }
});
