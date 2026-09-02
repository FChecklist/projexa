import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";

// Priority 13 (Permits as a first-class module): VERIDIAN's
// /api/v1/projexa/permits -- the Bearer-key-reachable twin of VERIDIAN's own
// cookie-only /api/documents/expiring?category=permit, so PROJEXA can show a
// permit-expiry list without a cookie session.
//
// Wave 143: `projectId` scopes to one project, `all=true` lists every
// permit for it (not just ones expiring soon) -- matches the real field
// spec (permit name / issue date / end date, per project). POST creates a
// new permit: a PDF upload plus those fields, relayed via
// callVeridianUpload (multipart, not JSON).
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const forward = new URLSearchParams();
  const withinDays = searchParams.get("withinDays");
  if (withinDays) forward.set("withinDays", withinDays);
  const projectId = searchParams.get("projectId");
  if (projectId) forward.set("projectId", projectId);
  if (searchParams.get("all") === "true") forward.set("all", "true");
  const qs = forward.toString();
  try {
    const data = await callVeridian(`/permits${qs ? `?${qs}` : ""}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load permits");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/permits", formData, { organizationId: ctx.organizationId! });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.permits, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create permit");
  }
}
