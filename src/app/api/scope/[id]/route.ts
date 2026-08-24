import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load BOQ" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

// R46/E-126b: proxies to compliance-tracker's new DELETE
// /api/v1/construction/boq/[id] (draft-only -- see that route's own
// deleteBoq() comment). Needed so e2e/demo-gate-smoke.spec.ts (the ONLY
// caller today) can clean up the real BOQs it creates on every CI run
// instead of leaking them onto the shared demo project forever.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to delete BOQ" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
