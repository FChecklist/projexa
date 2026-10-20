import { and, isNull, gt, sql } from "drizzle-orm";
import { db, orgInvites } from "@/lib/db";
import { defaultOrgName } from "./default-org-name";
import { provisionOrgForUser, type SupabaseLike } from "./provision-org";

// Silent organisation set-up for a signed-in person who has no membership (the e-mail-code sign-in creates the auth user and nothing else).
// Called by requireAuth() at its "No organization" branch: no form, no prompt, a default name from the e-mail, renamable later in Settings.
// Reuses provisionOrgForUser() (VERIDIAN first, per-user lock, single-flight), so nothing about provisioning is duplicated here.

export const PROVISION_FAILED_MESSAGE = "We couldn't set up your workspace just now. Please try again.";
export const PROVISION_FAILED_CODE = "ORG_PROVISION_FAILED";

export type AutoProvisionResult = { ok: true } | { ok: false; reason: "invite_pending" | "failed" };

/** After a failure, don't hammer VERIDIAN on every one of the ~6 parallel API calls a page makes. */
const COOLDOWN_MS = 10_000;
const recentFailure = new Map<string, number>();

/** A live invitation for this address means the person is about to JOIN an organisation, not start their own: leave them with none. */
async function hasPendingInvite(email: string | null): Promise<boolean> {
  if (!email) return false;
  try {
    const rows = await db
      .select({ id: orgInvites.id })
      .from(orgInvites)
      .where(and(sql`lower(${orgInvites.email}) = ${email.toLowerCase()}`, isNull(orgInvites.acceptedAt), isNull(orgInvites.revokedAt), gt(orgInvites.expiresAt, new Date())))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false; // can't tell: never block a person from getting a workspace because of this check
  }
}

export async function autoProvisionOrganization(
  supabase: SupabaseLike,
  user: { id: string; email: string | null },
  opts: { skipInviteCheck?: boolean; now?: () => number } = {},
): Promise<AutoProvisionResult> {
  const now = (opts.now ?? Date.now)();
  const failedAt = recentFailure.get(user.id);
  if (failedAt !== undefined && now - failedAt < COOLDOWN_MS) return { ok: false, reason: "failed" };

  if (!opts.skipInviteCheck && (await hasPendingInvite(user.email))) return { ok: false, reason: "invite_pending" };

  try {
    const out = await provisionOrgForUser(supabase, user.id, defaultOrgName(user.email));
    if (out.status === 200 || out.status === 201) {
      recentFailure.delete(user.id);
      return { ok: true };
    }
    console.error("[auto-provision] provisioning refused:", out.status, out.body.error);
  } catch (err) {
    console.error("[auto-provision] provisioning threw:", err instanceof Error ? err.message : err);
  }
  recentFailure.set(user.id, now);
  return { ok: false, reason: "failed" };
}

/** Test seam. */
export function resetAutoProvisionCooldown(): void {
  recentFailure.clear();
}
