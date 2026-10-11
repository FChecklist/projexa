import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// "Connect your AI": who may use MY connection. Any signed-in member, for their own connection only (VERIDIAN looks the connection up by the acting
// person, never by an id in this request).
export const dynamic = "force-dynamic";

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
  if (!body || !Array.isArray(body.userIds)) return NextResponse.json({ error: "Send the list of teammates to share with." }, { status: 400 });
  try {
    return NextResponse.json(await callVeridian("/own-ai/shares", { method: "POST", organizationId: ctx.organizationId!, body: { userIds: body.userIds } }));
  } catch (err) {
    return veridianErrorResponse(err, "Could not save who can use your AI");
  }
});
