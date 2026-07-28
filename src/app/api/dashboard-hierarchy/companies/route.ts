import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { listUserCompanies } from "@/lib/company-scope";

// "Company" level of the Company -> Department -> Project drill-down: the
// real list of PROJEXA organizations (tenants) the current user belongs to
// (e.g. a "PROJEXA UAE" org and a "PROJEXA India" org), via the existing
// many-to-many `memberships` table -- see company-scope.ts for why this is
// a real, pre-existing entity rather than a new one. Deliberately namespaced
// under /api/dashboard-hierarchy/* rather than /api/companies -- that path
// is already taken by VERIDIAN's unrelated erp_companies (sub-entities
// within a single org's accounting, e.g. head office vs a subsidiary) --
// this is a different concept: which org (tenant) is being viewed.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const companies = await listUserCompanies(ctx.user!.id);
  return NextResponse.json({ companies });
}
