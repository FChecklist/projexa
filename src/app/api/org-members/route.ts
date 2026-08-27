import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(email, display_name)")
    .eq("organization_id", ctx.organizationId!);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A4S14_settings_01: this previously filtered out `ctx.user!.id`, so the
  // Settings Team table never included the currently authenticated member
  // (owner or otherwise) -- even though GET /api/organization (which powers
  // the "Your Account" card on the same page) reads that same person's
  // role/email straight off ctx with no such filter. The roster is the full
  // membership list for the org; every member, including the caller, is a
  // real teammate and belongs in it.
  return NextResponse.json({ members: data ?? [] });
}
