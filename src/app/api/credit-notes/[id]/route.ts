import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Real-screen conversion (2026-08-30): single-credit-note GET for the
// Credit Note Object Page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const { id } = await params;
    const data = await callVeridian(`/credit-notes/${id}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load credit note");
  }
}
