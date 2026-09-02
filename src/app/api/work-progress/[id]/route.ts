import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-77, rec R-289): one work-progress entry.
//
// The Work Progress list has always been a dead end -- a row you could read
// and nothing you could click, because there was no route to a single entry on
// either side of the boundary. VERIDIAN's half is new too
// (v1/construction/progress/[id], aliased at v1/projexa/work-progress/[id]);
// this is the proxy the object page, its Edit and its Delete all go through.
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't load this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }
  try {
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!, method: "PATCH", body,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't save this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!, method: "DELETE",
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't delete this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
