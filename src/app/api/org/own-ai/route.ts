import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// "Connect your AI": the ORGANISATION's AI key, and the picture of who answers the signed-in person's chat. The key is tested and stored encrypted by
// VERIDIAN (/own-ai); this app never keeps it and a read never returns it.
//   GET     the picture for this person: who answers their chat (mine / shared with me / my organisation's / PROJEXA's own), what they connected, what a
//           teammate shared with them, what their organisation connected. Any signed-in person.
//   PUT     connect the organisation's AI.   DELETE  disconnect it.   Organisation owner or admin only (tier ORG_ADMIN in api-write-policy.ts, and again
//           here and on the VERIDIAN side). A person's OWN AI is /api/org/own-ai/mine, a different route so the tier table can say who may do which.
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const TEST_CALL_TIMEOUT_MS = 25_000;

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    return NextResponse.json(await callVeridian("/own-ai", { organizationId: ctx.organizationId! }));
  } catch (err) {
    return veridianErrorResponse(err, "Could not read this setting");
  }
});

export const PUT = withTiming("PUT", async function PUT(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;

  const body = (await request.json().catch(() => null)) as { provider?: unknown; model?: unknown; apiKey?: unknown } | null;
  if (!body || typeof body.provider !== "string" || typeof body.apiKey !== "string") {
    return NextResponse.json({ error: "Choose your AI and paste its key." }, { status: 400 });
  }
  try {
    const data = await callVeridian("/own-ai", {
      method: "PUT",
      organizationId: ctx.organizationId!,
      timeoutMs: TEST_CALL_TIMEOUT_MS,
      body: { scope: "org", provider: body.provider, model: typeof body.model === "string" ? body.model : undefined, apiKey: body.apiKey },
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Could not save this setting");
  }
});

export const DELETE = withTiming("DELETE", async function DELETE() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;
  try {
    return NextResponse.json(await callVeridian("/own-ai?scope=org", { method: "DELETE", organizationId: ctx.organizationId! }));
  } catch (err) {
    return veridianErrorResponse(err, "Could not remove the key");
  }
});
