import { db, memberships } from "@/lib/db";
import { and, eq } from "drizzle-orm";

// PROJEXA-NEXT-001 (2026-09-21) -- the server-side half of "last-used
// project". See drizzle/0028_memberships_last_project_id.sql for the full
// defect/fix writeup. This column is never authoritative on its own: every
// caller of getLastProjectId() must still check the returned id against the
// caller's live, permission-scoped project list (exactly as the
// veri.rail.project cookie already is in project-preference.ts's
// pickProject()/pickRouteProject()) before trusting it.

export async function getLastProjectId(organizationId: string, userId: string): Promise<string | null> {
  const row = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)),
    columns: { lastProjectId: true },
  });
  return row?.lastProjectId ?? null;
}

export async function setLastProjectId(organizationId: string, userId: string, projectId: string | null): Promise<void> {
  await db
    .update(memberships)
    .set({ lastProjectId: projectId })
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
}
