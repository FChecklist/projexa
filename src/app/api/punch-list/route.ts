import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { notifyOrgMembers, buildPunchListCreatedNotification } from "@/lib/services/notification-service";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/punch-list?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load punch list");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.FIELD);
  if (roleError) return roleError;
  const body = await request.json();
  try {
    const data = await callVeridian<{ id: string; description: string; priority: string }>("/punch-list", { organizationId: ctx.organizationId!, method: "POST", body });
    if (body.projectId) {
      await notifyOrgMembers(ctx.organizationId!, ctx.user!.id, buildPunchListCreatedNotification(data, body.projectId, ctx.user!.email));
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create punch list item");
  }
});
