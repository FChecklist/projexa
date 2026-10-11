import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// "Connect your AI": the signed-in person's OWN AI key. Any member, for themselves only: VERIDIAN stores it against the acting person, never against an id
// in this request. The key is tested once, stored encrypted and never returned. Disconnecting erases it and every teammate's access through it.
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const TEST_CALL_TIMEOUT_MS = 25_000;

export const PUT = withTiming("PUT", async function PUT(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = (await request.json().catch(() => null)) as { provider?: unknown; model?: unknown; apiKey?: unknown } | null;
  if (!body || typeof body.provider !== "string" || typeof body.apiKey !== "string") {
    return NextResponse.json({ error: "Choose your AI and paste its key." }, { status: 400 });
  }
  try {
    const data = await callVeridian("/own-ai", {
      method: "PUT",
      organizationId: ctx.organizationId!,
      timeoutMs: TEST_CALL_TIMEOUT_MS,
      body: { scope: "me", provider: body.provider, model: typeof body.model === "string" ? body.model : undefined, apiKey: body.apiKey },
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Could not save this setting");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    return NextResponse.json(await callVeridian("/own-ai?scope=me", { method: "DELETE", organizationId: ctx.organizationId! }));
  } catch (err) {
    return veridianErrorResponse(err, "Could not remove the key");
  }
});
