import Link from "next/link";
import { PageHeading } from "@/components/PageHeading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardHierarchyClient } from "@/components/DashboardHierarchyClient";
import { getOrganizationSummary } from "@/lib/company-scope";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Company -> Department -> Project drill-down, per the Owner's diagram:
// pick a Company (a PROJEXA org you're a member of), then a Department,
// then a Project, then see its Revenue/Budget/Expense/Progress with a
// date-range filter and its BOQ category-distribution charts. See
// src/lib/company-scope.ts for why "Company" maps to a PROJEXA org
// membership rather than VERIDIAN's separate erp_companies concept.
//
// R67 E-37 (R-269 / R-298). ORG CONTEXT, RESOLVED THE SAME WAY EVERY OTHER
// ROUTE RESOLVES IT. This page named no organisation at all, so a reader who
// hit its empty state could not tell whether "no company memberships" was
// about their own workspace or a resolution failure. It now resolves the org
// through getServerOrganizationId() -- the helper every other (app) page uses
// -- and puts the organisation's real name in the breadcrumb.
//
// A caller with NO organisation never reaches the client at all: nothing below
// can work, and the honest thing to say is who can fix it.
export default async function DashboardHierarchyPage() {
  const organizationId = await getServerOrganizationId();
  const organisation = organizationId ? await getOrganizationSummary(organizationId) : null;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Company Dashboard" breadcrumb={organisation?.name} />
      {organizationId ? (
        <DashboardHierarchyClient />
      ) : (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-px-ink" data-testid="hierarchy-not-a-member">
              Your account is not a member of any company yet. Ask an administrator to add you under{" "}
              <Link href="/settings" className="underline">
                Settings › Companies
              </Link>
              .
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
