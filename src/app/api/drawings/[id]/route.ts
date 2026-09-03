import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-11: the Bearer-key-reachable twin of VERIDIAN's
// /api/v1/projexa/drawings/[id]. The drawing object page used to read the
// GENERIC documents/[id] route, which knows nothing about drawings -- so it
// could not say whether a drawing was still inside its 24-hour grace window,
// how many records referenced it, or which project it belonged to, and there
// was no Edit or hard Remove behind it at all.
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/drawings/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load this drawing" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const body = await request.json();
    const data = await callVeridian(`/drawings/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to update this drawing" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/drawings/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "DELETE",
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to remove this drawing" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
