import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Internal AI answers through the Claude Code bridge on the owner's laptop (12 s or more per answer), so this call needs far more than the 8 s default.
export const maxDuration = 60;
const MODEL_CALL_TIMEOUT_MS = 55_000;

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  try {
    const result = await callVeridian<{ reply: string }>("/discuss", {
      organizationId: ctx.organizationId!,
      method: "POST",
      timeoutMs: MODEL_CALL_TIMEOUT_MS,
      body: { message, history: body.history ?? [] },
    });
    return NextResponse.json(result);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to reach VERI AI");
  }
});
