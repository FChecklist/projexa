import { db, memberships } from "@/lib/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { ROLE_GROUPS, type OrgRole } from "@/lib/authz/roles";

// Extracted from src/app/api/org-members/[id]/route.ts's PATCH handler so
// the Google Sheets Roles-tab sync (src/lib/google-sheets/pull.ts) enforces
// the exact same last-owner/admin lockout guard, not a re-implementation
// that could silently drift from it. Uses the direct Postgres connection
// (src/lib/db/index.ts) rather than the RLS-bound Supabase client the route
// used to use directly -- safe here because both callers already run their
// own authorization check (requireRole(ORG_ADMIN) for the route; the
// Submitted-by-email -> role resolution in pull.ts) before calling this.

export class MemberNotFoundError extends Error {}
export class LastAdminGuardError extends Error {}

export async function updateMemberRole(organizationId: string, targetUserId: string, role: OrgRole): Promise<{ user_id: string; role: string }> {
  const target = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, organizationId), eq(memberships.userId, targetUserId)),
  });
  if (!target) throw new MemberNotFoundError("Member not found");

  const wasOwnerOrAdmin = (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(target.role);
  const willBeOwnerOrAdmin = (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(role);
  if (wasOwnerOrAdmin && !willBeOwnerOrAdmin) {
    const remainingAdmins = await db.query.memberships.findMany({
      where: and(
        eq(memberships.organizationId, organizationId),
        inArray(memberships.role, ROLE_GROUPS.ORG_ADMIN as unknown as string[]),
        ne(memberships.userId, targetUserId)
      ),
    });
    if (remainingAdmins.length === 0) {
      throw new LastAdminGuardError("Cannot change this member's role: every organization must keep at least one owner or admin.");
    }
  }

  const [updated] = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, targetUserId)))
    .returning({ user_id: memberships.userId, role: memberships.role });

  if (!updated) throw new MemberNotFoundError("Member not found");
  return updated;
}
