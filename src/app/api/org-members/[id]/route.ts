import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS, ALL_ORG_ROLES, type OrgRole } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// The only in-product way to move a membership off the default 'member'
// role onto pm/site_engineer/client_viewer (or to owner/admin) -- see PR #53
// audit finding: without this, every existing non-owner/admin member gets
// 403'd off all six newly role-gated routes with no recovery path short of
// a manual Supabase edit. Restricted to ROLE_GROUPS.ORG_ADMIN (owner/admin)
// since role assignment is itself a privileged action.
export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
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

  // Last-owner/admin guard: this endpoint is the only in-product way to
  // change a membership's role, so without this check an owner/admin could
  // demote (or another owner/admin could be demoted/self-demote) the org's
  // last remaining owner/admin, stranding the org with zero owners/admins
  // and no in-product recovery path -- the exact lockout risk the PM/
  // site-engineer role model was built to avoid, just relocated here.
  const { data: target, error: targetError } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", ctx.organizationId!)
    .eq("user_id", id)
    .maybeSingle();
  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const wasOwnerOrAdmin = (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(target.role);
  const willBeOwnerOrAdmin = (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(role);
  if (wasOwnerOrAdmin && !willBeOwnerOrAdmin) {
    const { count, error: countError } = await supabase
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId!)
      .in("role", ROLE_GROUPS.ORG_ADMIN)
      .neq("user_id", id);
    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    if (!count) {
      return NextResponse.json(
        { error: "Cannot change this member's role: every organization must keep at least one owner or admin." },
        { status: 409 }
      );
    }
  }

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
});
