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
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";
import BudgetActualClient from "@/components/BudgetActualClient";

// R67 D-23 x F-18: the heading moved INSIDE the boundary so it can name the
// resolved project (see ScopeSection), which means the fallback has to paint
// it too -- otherwise the title would arrive with the list instead of at TTFB,
// which is the whole point of F-18. Same shape as moms/page.tsx.
const SKELETON = (
  <>
    <PageHeading title="Scope of Work (BOQ)" />
    <ModuleListSkeletonBody columns={BOQ_LIST_COLUMNS} tabs={["BOQ", "Cost Variance"]} actions={["New BOQ"]} />
  </>
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

  if (errorMessage) {
    return (
      <>
        <PageHeading title="Scope of Work (BOQ)" />
        <ModuleProjectNotice errorMessage={errorMessage} />
      </>
    );
  }
  // Two different answers, told apart at last.
  if (!projectId && mode === "all") {
    return (
      <>
        <PageHeading title="Scope of Work (BOQ)" />
        <ProjectRequiredCard module="BOQs" />
      </>
    );
  }
  if (!projectId) {
    return (
      <>
        <PageHeading title="Scope of Work (BOQ)" />
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent>
        </Card>
      </>
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
    <>
    {/* R67 D-23: the resolved project's own NAME in the heading. The BOQ list
        is entirely project-scoped and resolveProjectForModule() can fall back
        to the org's first project, so a heading that never named the project
        left the user reading someone else's scope with no way to notice. It
        renders here rather than in the page shell because the name is not
        known until this section resolves; SKELETON paints the unnamed title
        at TTFB so nothing is late. */}
    <PageHeading title="Scope of Work (BOQ)" context={name} />
    {/* R42 seq24: "variance" is DASHBOARD.PROJECT's own "Budget vs Actual" KPI
        destination (?tab=variance). The BOQ tab stays the CUSTOM weighted-tree
        screen; variance is a different, flat "which line is worst" question. */}
    {/* R67 E-08 (R-115): "Budget" is the third tab -- Sumeet item 9's Revenue /
        Budget / Actual, scope-wise and category-wise. The item asks for it on
        the project-scoped Budget screen (C03-16); until that ships it lives
        here, beside the BOQ it is derived from, which is the item's own stated
        fallback. */}
    <Tabs defaultValue={tab === "variance" ? "variance" : tab === "budget" ? "budget" : "boq"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="boq">BOQ</TabsTrigger>
        <TabsTrigger value="variance">Cost Variance</TabsTrigger>
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
      <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]">
        <CostVarianceAnalyticalClient projectId={projectId} />
      </TabsContent>
      <TabsContent value="budget">
        <BudgetActualClient projectId={projectId} />
      </TabsContent>
    </Tabs>
    </>
  );
}

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <Suspense fallback={SKELETON}>
        <ScopeSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
