// WO-PROJEXA-AI-LINK-001: a per-(org, user) token addressing a read-only,
// personal-data-excluded snapshot (public.ai_link_projection, SECURITY
// DEFINER STABLE -- see drizzle/0023_ai_link_and_email.sql). The token
// carries NO authority by itself; org_ai_link has RLS enabled with zero
// anon/authenticated policies (same posture as veridianCredentials), so
// every function here reads/writes it through `db` -- the direct Postgres
// connection (SUPABASE_DB_PASSWORD-based, not the RLS-scoped Supabase-JS
// client) that veridian-client.ts already uses for that identical reason.
// There is no separate "service-role client" in this repo (confirmed by
// grep before writing this) and none is needed: `db`'s own connection role
// already bypasses RLS, which is exactly what veridianCredentials relies on
// today.
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, orgAiLink } from "@/lib/db";

function randomToken(): string {
  // Plaintext by design -- see this file's own header. 32 bytes of
  // url-safe base64 is unguessable enough for "an address", which is all
  // this token needs to be; it is not a credential.
  return randomBytes(32).toString("base64url");
}

export type OrgAiLinkRow = typeof orgAiLink.$inferSelect;

/** The caller's own active link, or null if they've never created one. */
export async function getMyAiLink(organizationId: string, userId: string): Promise<OrgAiLinkRow | null> {
  const [row] = await db
    .select()
    .from(orgAiLink)
    .where(and(eq(orgAiLink.organizationId, organizationId), eq(orgAiLink.userId, userId), isNull(orgAiLink.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** "Get my link" -- idempotent, same posture as VERIDIAN's DPDP referral get-or-create. */
export async function getOrCreateMyAiLink(organizationId: string, userId: string): Promise<OrgAiLinkRow> {
  const existing = await getMyAiLink(organizationId, userId);
  if (existing) return existing;
  const [row] = await db
    .insert(orgAiLink)
    .values({ organizationId, userId, token: randomToken() })
    .returning();
  return row;
}

/** Rotate: revoke whatever is active, issue a fresh token. The old link stops working immediately. */
export async function rotateMyAiLink(organizationId: string, userId: string): Promise<OrgAiLinkRow> {
  await db
    .update(orgAiLink)
    .set({ revokedAt: new Date() })
    .where(and(eq(orgAiLink.organizationId, organizationId), eq(orgAiLink.userId, userId), isNull(orgAiLink.revokedAt)));
  const [row] = await db
    .insert(orgAiLink)
    .values({ organizationId, userId, token: randomToken() })
    .returning();
  return row;
}

export async function revokeMyAiLink(organizationId: string, userId: string): Promise<void> {
  await db
    .update(orgAiLink)
    .set({ revokedAt: new Date() })
    .where(and(eq(orgAiLink.organizationId, organizationId), eq(orgAiLink.userId, userId), isNull(orgAiLink.revokedAt)));
}

export type ResolvedAiLink = { organizationId: string; userId: string } | null;

/** The public route's own lookup: token -> (org, user), or null if missing/revoked/expired. Never throws on a bad token -- the route decides how to respond. */
export async function resolveAiLinkToken(token: string): Promise<ResolvedAiLink> {
  const [row] = await db.select().from(orgAiLink).where(eq(orgAiLink.token, token)).limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;
  return { organizationId: row.organizationId, userId: row.userId };
}

/**
 * The projection itself: calls public.ai_link_projection(p_org, p_user), the
 * SECURITY DEFINER function that is the actual personal-data exclusion
 * boundary (see drizzle/0023's own header for why that boundary lives in
 * SQL and not here). This function does not re-implement or duplicate that
 * boundary -- it only invokes it and returns the text it produces.
 */
export async function getAiLinkProjection(organizationId: string, userId: string): Promise<string> {
  const result = await db.execute(sql`select public.ai_link_projection(${organizationId}::uuid, ${userId}::uuid) as projection`);
  const row = result[0] as { projection: string } | undefined;
  return row?.projection ?? "";
}
