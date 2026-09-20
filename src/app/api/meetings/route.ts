import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/meetings?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load meetings");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/meetings", { organizationId: ctx.organizationId!, method: "POST", body });
    // Cold-load fix: meetings/page.tsx now caches the module list 30s
    // (module-list-source.ts's fetchMeetingsList), so a create must clear it
    // or the new row is invisible on the next server render until the
    // window expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.meetings, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create meeting");
  }
});
