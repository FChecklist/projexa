import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getSettingsMembers } from "@/lib/settings-source";
import { withTiming } from "@/lib/with-timing";

// PROJEXA-E2E-001 cold-load fix (2026-09-21): query moved into
// settings-source.ts's getSettingsMembers() -- see /api/organization's own
// comment for why (one implementation, this route AND /settings's server
// component both call it). Behavior unchanged, including A4S14_settings_01
// below.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const result = await getSettingsMembers(ctx.organizationId!);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
  // A4S14_settings_01: this previously filtered out `ctx.user!.id`, so the
  // Settings Team table never included the currently authenticated member
  // (owner or otherwise) -- even though GET /api/organization (which powers
  // the "Your Account" card on the same page) reads that same person's
  // role/email straight off ctx with no such filter. The roster is the full
  // membership list for the org; every member, including the caller, is a
  // real teammate and belongs in it.
  return NextResponse.json(result);
});
