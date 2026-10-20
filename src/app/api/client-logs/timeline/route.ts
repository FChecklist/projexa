import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// One project from start to end: every action and every error, in time order. Owner / admin only.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // Optional paging for a long project: ?order=asc|desc, ?after=<ISO time> (a cursor), ?limit=<=1000.
  const sp = request.nextUrl.searchParams;
  const params = new URLSearchParams({ projectId });
  if (sp.get("order") === "desc") params.set("order", "desc");
  const after = sp.get("after");
  if (after) {
    if (Number.isNaN(new Date(after).getTime())) return NextResponse.json({ error: "after must be a valid timestamp" }, { status: 400 });
    params.set("after", after);
  }
  const limit = Number(sp.get("limit"));
  if (Number.isInteger(limit) && limit > 0) params.set("limit", String(Math.min(limit, 1000)));
  try {
    const data = await callVeridian(`/client-logs/timeline?${params.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the project timeline");
  }
});
