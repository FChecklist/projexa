import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): revoke half of the portal-links
// pair, see ../route.ts's own comment.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id, linkId } = await params;
    const data = await callVeridian(`/vendors/${encodeURIComponent(id)}/portal-links/${encodeURIComponent(linkId)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to revoke portal link" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
