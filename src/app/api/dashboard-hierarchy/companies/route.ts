import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getOrganizationSummary, listUserCompanies, resolveHierarchyCompanies } from "@/lib/company-scope";

// "Company" level of the Company -> Department -> Project drill-down: the
// real list of PROJEXA organizations (tenants) the current user belongs to
// (e.g. a "PROJEXA UAE" org and a "PROJEXA India" org), via the existing
// many-to-many `memberships` table -- see company-scope.ts for why this is
// a real, pre-existing entity rather than a new one. Deliberately namespaced
// under /api/dashboard-hierarchy/* rather than /api/companies -- that path
// is already taken by VERIDIAN's unrelated erp_companies (sub-entities
// within a single org's accounting, e.g. head office vs a subsidiary) --
// this is a different concept: which org (tenant) is being viewed.
//
// R67 E-37 (R-269 / R-298). THE LIST IS NEVER SILENTLY EMPTY ANY MORE.
// listUserCompanies INNER JOINs organizations, so an orphaned membership (a
// membership row whose organisation row is gone) returned nothing and the
// screen dead-ended on "No company memberships found for this account." --
// with no way to tell that from a caller who really belongs to no company,
// and no way at all to reach the departments and projects below. The response
// now carries WHY it is empty, and when the caller's own organisation can
// name a company, resolveHierarchyCompanies synthesises one from it (a
// read-time fallback; nothing is written).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const memberships = await listUserCompanies(ctx.user!.id);
  // Only looked up when there is nothing to list -- the happy path keeps its
  // single query.
  const organisation =
    memberships.length === 0 && ctx.organizationId ? await getOrganizationSummary(ctx.organizationId) : null;

  const resolved = resolveHierarchyCompanies(memberships, organisation, ctx.organizationId, ctx.role);
  return NextResponse.json(resolved);
}
