import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

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
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create permit");
  }
}
