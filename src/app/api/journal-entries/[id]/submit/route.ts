import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): proxies to VERIDIAN's new
// /v1/projexa/journal-entries/[id]/submit. Real, honest limitation
// (documented server-side too): PROJEXA's shared-API-key session has no
// per-user identity bridge to VERIDIAN, so this will 400 with that real
// message until that bridge exists -- same as the Board/Timesheet "Log
// Time" actions and change-order submission.
export const POST = withTiming("POST", async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/journal-entries/${encodeURIComponent(id)}/submit`, { organizationId: ctx.organizationId!, method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit journal entry");
  }
});
