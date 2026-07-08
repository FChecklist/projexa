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
  return NextResponse.json({ members: (data ?? []).filter((m) => m.user_id !== ctx.user!.id) });
}
