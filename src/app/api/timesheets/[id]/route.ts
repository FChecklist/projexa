import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 WS-H (item H-01): the Design Studio object page opens ONE entry
// read-only (GET) and edits it only after an explicit Edit (PATCH), per
// D-11 "object pages are display-first". DELETE was already here.
//
// Every method forwards the logged-in PROJEXA user as X-Acting-User (D-05),
// because all three of VERIDIAN's checks -- only the logging user may edit,
// only the logging user may delete, only a draft may be edited -- are
// meaningless if the caller is only ever "the org key".
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      method: "PATCH",
      body: { ...body, actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to update time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      method: "DELETE",
      body: { actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to delete time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
