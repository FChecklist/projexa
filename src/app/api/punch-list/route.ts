import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { notifyOrgMembers, buildPunchListCreatedNotification } from "@/lib/services/notification-service";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/punch-list?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load punch list" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian<{ id: string; description: string; priority: string }>("/punch-list", { organizationId: ctx.organizationId!, method: "POST", body });
    if (body.projectId) {
      await notifyOrgMembers(ctx.organizationId!, ctx.user!.id, buildPunchListCreatedNotification(data, body.projectId, ctx.user!.email));
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create punch list item" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
