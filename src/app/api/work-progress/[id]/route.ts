import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-28 (R-069) x R67 lane D22 (item D-77, rec R-289): one work-progress
// entry. The Work Progress list has always been a dead end -- a row you could
// read and nothing you could click -- because there was no route to a single
// entry on either side of the boundary, so a mis-keyed quantity was permanent.
// VERIDIAN's half is new too (v1/construction/progress/[id], aliased at
// v1/projexa/work-progress/[id]); these three relay it, and it runs exactly the
// same validation the create path runs. The backend's message is passed through
// verbatim rather than replaced with a generic one, because the site engineer
// needs to read the actual rule they hit (the parent-BOQ-line refusal, say),
// not "Failed to save".
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  // Kept from lane D22: an unparseable body is a 400 that says so, not an
  // unhandled throw the catch below would report as a 502 against VERIDIAN --
  // which would blame the backend for a request that never reached it.
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }
  try {
    const { id } = await params;
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to save this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/work-progress/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to delete this progress entry" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
