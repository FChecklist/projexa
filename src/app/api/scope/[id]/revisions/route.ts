import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/revisions`, { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof VeridianApiError) {
      // R67 D-27: the scope-reduction 409 carries `conflicts[]` -- the lines
      // this revision would reduce or remove that already have recorded
      // progress. Forwarded DELIBERATELY and by name, so the revise screen can
      // render "R60SK-A - 12 m2 recorded on 28 Aug 2026" in a table above the
      // override instead of printing a paragraph. Nothing else from the
      // upstream body is passed on; `message` stays the only user-facing text.
      const conflicts = (err.body as { conflicts?: unknown } | undefined)?.conflicts;
      return NextResponse.json(
        { error: err.message, ...(Array.isArray(conflicts) ? { conflicts } : {}) },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "Failed to create scope revision" }, { status: 502 });
  }
}
