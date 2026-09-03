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

// ---------------------------------------------------------------------------
// R67 E-37 (R-269 / R-298): /dashboard/hierarchy always has a root.
// ---------------------------------------------------------------------------

export type OrganizationSummary = { id: string; name: string; slug: string; country: string | null };

/**
 * The organisation the caller is actually working in, by id. Used to give the
 * hierarchy page its org context (the breadcrumb) and to synthesise a company
 * row when no membership row names one.
 */
export async function getOrganizationSummary(orgId: string): Promise<OrganizationSummary | null> {
  const [row] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, country: organizations.country })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * Why the company list is empty, when it is. These are three genuinely
 * different situations with three different next actions, and the screen used
 * to print one sentence ("No company memberships found for this account.") for
 * all of them -- including for a FAILED request, which is not an empty list at
 * all.
 */
export type HierarchyEmptyReason =
  /** Not empty. */
  | "none"
  /**
   * The caller's session names an organisation id, but no organisation row
   * answers to it -- so there is no company to name the hierarchy after and
   * nothing to synthesise one from. Reachable today through an orphaned
   * membership, which listUserCompanies' INNER JOIN silently drops.
   */
  | "no-company"
  /** The caller is authenticated and belongs to no organisation at all. */
  | "not-a-member";

export type HierarchyCompanies = {
  companies: CompanyMembership[];
  /** True when the single row below was SYNTHESISED, not read from a membership. */
  synthesized: boolean;
  emptyReason: HierarchyEmptyReason;
};

/**
 * R67 E-37 (R-269). THE HIERARCHY ALWAYS HAS A ROOT.
 *
 * The Company -> Department -> Project drill-down starts at a company, and
 * "company" here is a PROJEXA organisation the caller is a member of (see
 * listUserCompanies above and this file's own header for why). When the
 * membership join returns nothing, every level below it is unreachable and the
 * screen dead-ends -- which is exactly what R-269 observed.
 *
 * This synthesises ONE company from the caller's own organisation instead: same
 * id, the organisation's real name, the caller's real role. It is a read-time
 * fallback and writes NOTHING -- no production data is invented, and the
 * moment a real membership row exists it wins.
 *
 * PURE ON PURPOSE. The two reads (memberships, organisation) stay in the route;
 * this decides what to do with their results, so the decision -- which is the
 * part with three branches and a wrong answer in each -- is unit-testable
 * without a database.
 *
 * The department half of "one company with one department 'All' containing
 * every project" needs no synthesis: the hierarchy client already offers "All
 * departments" as its own default option, and that selection loads every
 * project in the company. Fabricating a department ROW would put a name in a
 * dropdown that matches nothing in HR.
 */
export function resolveHierarchyCompanies(
  memberships: CompanyMembership[],
  organisation: OrganizationSummary | null,
  organizationId: string | null,
  role: string | null
): HierarchyCompanies {
  if (memberships.length > 0) {
    return { companies: memberships, synthesized: false, emptyReason: "none" };
  }
  if (!organisation) {
    // Two different nothings. A caller whose session names an organisation id
    // that no row answers to has an organisation which is not set up as a
    // company; a caller with no organisation id at all is not a member of one,
    // and only an administrator can change that.
    return {
      companies: [],
      synthesized: false,
      emptyReason: organizationId ? "no-company" : "not-a-member",
    };
  }
  return {
    companies: [
      {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        country: organisation.country,
        role: role ?? "member",
      },
    ],
    synthesized: true,
    emptyReason: "none",
  };
}
