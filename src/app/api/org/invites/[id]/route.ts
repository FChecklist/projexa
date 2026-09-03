import { NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

// Revoke. Deliberately a SOFT revoke (revoked_at) rather than a DELETE: UAT
// criterion C11, and the SAP LOEKZ convention, both require a deletion FLAG
// rather than a physical delete wherever a record carries history. Who
// invited whom, and that it was withdrawn, is exactly what an auditor asks
// about later.
export const DELETE = withTiming("DELETE", async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const forbidden = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (forbidden) return forbidden;

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("org_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.organizationId!)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "That invitation no longer exists, or has already been used or revoked." },
      { status: 404 }
    );
  }
  return NextResponse.json({ revoked: data.id });
});
