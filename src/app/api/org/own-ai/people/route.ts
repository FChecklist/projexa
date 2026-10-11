import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// "Connect your AI": the teammates a person may share their connection with (name and role only).
export const dynamic = "force-dynamic";

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    return NextResponse.json(await callVeridian("/own-ai/people", { organizationId: ctx.organizationId! }));
  } catch (err) {
    return veridianErrorResponse(err, "Could not list your teammates");
  }
});
