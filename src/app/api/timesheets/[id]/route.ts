import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 WS-H (item H-01): the Design Studio object page opens ONE entry
// read-only (GET) and edits it only after an explicit Edit (PATCH), per
// D-11 "object pages are display-first". DELETE was already here.
//
// Every method forwards the logged-in PROJEXA user as X-Acting-User (D-05),
// because all three of VERIDIAN's checks -- only the logging user may edit,
// only the logging user may delete, only a draft may be edited -- are
// meaningless if the caller is only ever "the org key".
type RouteContext = { params: Promise<{ id: string }> };

export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load time entry");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
      method: "PATCH",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update time entry");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
      method: "DELETE",
      body: {},
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to delete time entry");
  }
});
