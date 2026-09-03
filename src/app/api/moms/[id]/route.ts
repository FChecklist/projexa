import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load meeting");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json();
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}`, { method: "PATCH", body, organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update meeting");
  }
});

// R67 D-17: Delete had no route on either side, so the object page could only
// ever HIDE the control rather than show it disabled with a reason. VERIDIAN's
// deleteVeriMeeting soft-deletes DRAFTS ONLY and refuses a published meeting
// with the same sentence the disabled button carries, so the refusal is
// relayed verbatim rather than reworded here.
//
// R67 integration: wrapped in withTiming() like its two siblings (F-28), and
// its failure goes through veridianErrorResponse() rather than a hand-rolled
// instanceof ladder, so the Server-Timing header and the retry advice are the
// same on every method of this route.
export const DELETE = withTiming("DELETE", async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}`, { method: "DELETE", organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to delete meeting");
  }
});
