// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale. /scope was the worst measured screen: this page awaited
// getServerOrganizationId(), then a VERIDIAN /dashboard call, then a
// /screen-definitions/boq.custom call, all in series, before the first byte --
// and only then did ScopeClient start fetching. The frame now streams first
// and the revision list is fetched here on the server.
//
// R67 F-23: the list this page fetches now asks for `include=variation`, so the
// "Variation vs. prior" column arrives with the rows and ScopeClient's
// one-request-per-revision compare fan-out is gone (see fetchScopeList).
//
// R67 MERGE (lane D0 x lane F2). Lane D0 implemented the same decision D-04 on
// this page with resolveSelectedProject + ScreenLoading, and added two things
// F2's version did not have. Both are kept:
//
//   * D-20 / D-66's HONEST MODE. A BOQ belongs to exactly one project, so this
//     module OPTS IN with allProjectsWhenUnset. Without it, arriving with no
//     ?projectId= silently resolved the org's FIRST project and rendered its
//     BOQs under a rail reading "All projects" -- and a revision created there
//     was created against a project nobody chose. "You are looking at the whole
//     org and a BOQ needs one project" (ProjectRequiredCard) is a different
//     answer from "this org has no projects", and they are told apart here.
//   * D-65's PROJECT NAME, which travels with the id so the pane can name what
//     it is waiting for and the empty sentence can name the project it is
//     empty FOR.
//
// What is NOT kept is lane D0's local resolveRegistryColumns(): the identical
// 404-tolerant lookup now lives in module-list-source's getScreenColumns(),
// which additionally caches it for an hour per org. Nothing else imported the
// page-local copy.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { ProjectRequiredCard } from "@/components/ProjectRequiredCard";
import { BOQ_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchScopeList, getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ScopeClient, { type Boq } from "@/components/ScopeClient";
import BudgetAnalyticalClient from "@/components/BudgetAnalyticalClient";

const SKELETON = (
  <ModuleListSkeletonBody columns={BOQ_LIST_COLUMNS} tabs={["BOQ", "Budget"]} actions={["New BOQ"]} />
);

async function ScopeSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, mode } = await resolveProjectForModule(
    requestedProjectId,
    organizationId,
    // R67 D-20 + D-66: a BOQ belongs to exactly one project, so this module
    // opts in to the honest mode rather than having one chosen for it.
    { allProjectsWhenUnset: true }
  );

  if (errorMessage) return <ModuleProjectNotice errorMessage={errorMessage} />;
  // Two different answers, told apart at last.
  if (!projectId && mode === "all") return <ProjectRequiredCard module="BOQs" />;
  if (!projectId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent>
      </Card>
    );
  }

  // R46 P8 seq121: boq.custom is a CUSTOM-archetype row -- ScopeClient stays a
  // fully hand-built component (BOQ hierarchy/revisions/weighted sub-tasks are
  // too bespoke for a generic LIST renderer), but the main BOQ table's column
  // LABELS come from this registry row so they're editable with no redeploy.
  const [boqListColumns, list, name] = await Promise.all([
    getScreenColumns("boq.custom", organizationId),
    fetchScopeList<Boq>(organizationId, projectId, "scope of work"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  return (
    // R42 seq24: "variance" is DASHBOARD.PROJECT's own "Budget vs Actual" KPI
    // destination (?tab=variance). The BOQ tab stays the CUSTOM weighted-tree
    // screen; the second tab is a different, flat "where is the money" question.
    //
    // R67 D-62 (lane D1). That second tab was called "Cost Variance" and was
    // READ-ONLY. It is PROJEXA's project budget -- the thing Sumeet's own budget
    // sheet is -- so it is named Budget and is editable in place, which is why
    // BudgetAnalyticalClient replaces CostVarianceAnalyticalClient here and the
    // latter is deleted rather than left as a second, read-only door to the same
    // figures. ?tab=variance is still honoured: it is the URL DASHBOARD.PROJECT
    // shipped with, and the one every bookmark and older screenshot carries.
    <Tabs defaultValue={tab === "budget" || tab === "variance" ? "budget" : "boq"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="boq">BOQ</TabsTrigger>
        <TabsTrigger value="budget">Budget</TabsTrigger>
      </TabsList>
      <TabsContent value="boq">
        <ScopeClient
          projectId={projectId}
          projectName={name}
          listColumns={boqListColumns}
          initial={list}
        />
      </TabsContent>
      <TabsContent value="budget" className="h-[calc(100vh-14rem)] min-h-[560px]">
        <BudgetAnalyticalClient projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Scope of Work (BOQ)" />
      <Suspense fallback={SKELETON}>
        <ScopeSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
