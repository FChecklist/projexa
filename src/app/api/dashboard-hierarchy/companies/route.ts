import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getOrganizationSummary, listUserCompanies, resolveHierarchyCompanies } from "@/lib/company-scope";
import { withTiming } from "@/lib/with-timing";

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
// R67 MERGE (D-11, lane E2's E-37 x lane F-28): withTiming() wraps this route
// like every other one in this family now -- main's own addition, kept
// because it costs nothing and this route had no reason to be the exception.
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
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  // R67 E-37 follow-up. "YOU BELONG TO NO COMPANY" IS AN ANSWER, NOT AN ERROR.
  //
  // requireAuth() replies 400 "No organization" whenever the caller has no
  // memberships row (auth-guard.ts). Returning that verbatim made the empty
  // state this item exists to create UNREACHABLE: the client's getJson() turns
  // any !res.ok into null, so a member-less caller landed in the "failed"
  // branch and read "Couldn't load your companies" beside a Retry that could
  // never succeed -- a confident wrong answer, which is the exact defect class
  // E-37 is closing. For THIS route that state is the reply, so it is answered
  // with a 200 carrying emptyReason "not-a-member" and the client's already
  // correct branch renders the sentence the item quotes.
  //
  // Only that one status is reinterpreted. 401 (no valid session) and 503 (the
  // membership lookup itself failed twice -- see auth-guard's retry) are real
  // failures and still propagate, so "we could not ask" never masquerades as
  // "you belong to nothing".
  if (ctx.response) {
    if (!ctx.user || ctx.response.status !== 400) return ctx.response;
    return NextResponse.json(resolveHierarchyCompanies([], null, null, null));
  }

  const memberships = await listUserCompanies(ctx.user!.id);
  // Only looked up when there is nothing to list -- the happy path keeps its
  // single query.
  const organisation =
    memberships.length === 0 && ctx.organizationId ? await getOrganizationSummary(ctx.organizationId) : null;

  const resolved = resolveHierarchyCompanies(memberships, organisation, ctx.organizationId, ctx.role);
  return NextResponse.json(resolved);
});
