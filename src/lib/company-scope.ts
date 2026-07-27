import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";
import { requireAuth } from "@/lib/supabase/auth-guard";

// "Company" level of the Company -> Department -> Project drill-down
// (PROJEXA-DASHBOARD-HIERARCHY-01): a PROJEXA organization already IS a
// real, isolated tenant/legal-entity (see schema.ts's `organizations.country`
// comment -- "every real PROJEXA org currently shares" one VERIDIAN tenant),
// and `memberships` is already many-to-many, so a user who belongs to more
// than one org (e.g. a "PROJEXA UAE" org and a "PROJEXA India" org) already
// has real multi-company data to switch between. The only missing piece was
// that requireAuth()/getServerOrganizationId() always hard-picks the first
// membership row with no way to choose otherwise. This file adds that
// choice as an explicit, verified companyId query param -- it does not
// change requireAuth()'s own default-org resolution (session/cookie-based
// org switching app-wide is a separate, much larger change).
export type CompanyMembership = { id: string; name: string; slug: string; country: string | null; role: string };

export async function listUserCompanies(userId: string): Promise<CompanyMembership[]> {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, country: organizations.country, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type CompanyScopeContext =
  | { userId: string; companyId: string; role: string; response: null }
  | { userId: null; companyId: null; role: null; response: NextResponse };

// Verifies the caller has a real membership row for the requested companyId
// -- required before using it as the organizationId on any callVeridian()
// call, since that id also selects which org's VERIDIAN API key is used
// (see veridian-client.ts's resolveApiKey()). Without this check, a caller
// could pass any org's UUID and read that org's construction data.
export async function requireCompanyScope(companyId: string | null): Promise<CompanyScopeContext> {
  const ctx = await requireAuth();
  if (ctx.response || !ctx.user) {
    return { userId: null, companyId: null, role: null, response: ctx.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!companyId) {
    return { userId: null, companyId: null, role: null, response: NextResponse.json({ error: "companyId query param is required" }, { status: 400 }) };
  }

  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, ctx.user.id), eq(memberships.organizationId, companyId)))
    .limit(1);

  if (!membership) {
    return { userId: null, companyId: null, role: null, response: NextResponse.json({ error: "Not a member of this company" }, { status: 403 }) };
  }

  return { userId: ctx.user.id, companyId, role: membership.role, response: null };
}
