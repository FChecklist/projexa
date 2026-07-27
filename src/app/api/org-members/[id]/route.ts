import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS, ALL_ORG_ROLES, type OrgRole } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// The only in-product way to move a membership off the default 'member'
// role onto pm/site_engineer/client_viewer (or to owner/admin) -- see PR #53
// audit finding: without this, every existing non-owner/admin member gets
// 403'd off all six newly role-gated routes with no recovery path short of
// a manual Supabase edit. Restricted to ROLE_GROUPS.ORG_ADMIN (owner/admin)
// since role assignment is itself a privileged action.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;

  const { id } = await params;
  const body = await request.json().catch(() => null) as { role?: string } | null;
  const role = body?.role;
  if (!role || !ALL_ORG_ROLES.includes(role as OrgRole)) {
    return NextResponse.json({ error: `role must be one of: ${ALL_ORG_ROLES.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("organization_id", ctx.organizationId!)
    .eq("user_id", id)
    .select("user_id, role")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json({ member: data });
}
