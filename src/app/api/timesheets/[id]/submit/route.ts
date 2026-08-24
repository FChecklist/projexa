import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C12: was missing entirely -- draft->submitted had no PROJEXA route.
//
// R39/R-C12 fix-2 (live-oracle finding): PROJEXA calls VERIDIAN with a
// single shared per-org API key, never a per-user identity (see
// veridian-client.ts's own header comment) -- VERIDIAN's route couldn't
// tell WHO was submitting without this, and always 400'd. Forwarding this
// real session's email lets VERIDIAN resolve the real acting user itself
// (resolveActingUser() in its own auth-guard.ts).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/timesheets/${encodeURIComponent(id)}/submit`, {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { actorEmail: ctx.user?.email ?? null },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to submit time entry" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
