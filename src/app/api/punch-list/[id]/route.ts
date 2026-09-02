import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type RouteContext = { params: Promise<{ id: string }> };

// Real-screen conversion (2026-08-30): single-item GET for the Punch List
// Object Page.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/punch-list/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load punch list item");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.FIELD);
  if (roleError) return roleError;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/punch-list/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update punch list item");
  }
}
