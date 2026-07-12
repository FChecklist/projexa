import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";

// Real PROJEXA-side data (organizations table), not VERIDIAN -- see
// drizzle/0001_projexa_tenant_schema.sql. requireAuth() already resolves
// organizationId/role from the membership row; this just adds the
// organization's own name/slug, which nothing else in the app has needed
// to fetch until now.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const supabase = await createClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at")
    .eq("id", ctx.organizationId!)
    .single();

  if (error || !org) return NextResponse.json({ error: error?.message ?? "Organization not found" }, { status: 404 });
  return NextResponse.json({ organization: org, role: ctx.role, email: ctx.user!.email });
}
