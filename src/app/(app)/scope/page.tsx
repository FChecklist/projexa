// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale. /scope was the worst measured screen: this page awaited
// getServerOrganizationId(), then a VERIDIAN /dashboard call, then a
// /screen-definitions/boq.custom call, all in series, before the first byte --
// and only then did ScopeClient start fetching. The frame now streams first
// and the revision list is fetched here on the server.
//
// The per-revision compare fan-out inside ScopeClient is NOT addressed here;
// folding those figures into the list payload is F-23/F-29.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { BOQ_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchScopeList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ScopeClient, { type Boq } from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

const SKELETON = (
  <ModuleListSkeletonBody columns={BOQ_LIST_COLUMNS} tabs={["BOQ", "Cost Variance"]} actions={["New BOQ"]} />
);

async function ScopeSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  // R46 P8 seq121: boq.custom is a CUSTOM-archetype row -- ScopeClient stays a
  // fully hand-built component (BOQ hierarchy/revisions/weighted sub-tasks are
  // too bespoke for a generic LIST renderer), but the main BOQ table's column
  // LABELS come from this registry row so they're editable with no redeploy.
  const [boqListColumns, list] = await Promise.all([
    getScreenColumns("boq.custom", organizationId),
    fetchScopeList<Boq>(organizationId, projectId, "scope of work"),
  ]);

  return (
    // R42 seq24: "variance" is DASHBOARD.PROJECT's own "Budget vs Actual" KPI
    // destination (?tab=variance). The BOQ tab stays the CUSTOM weighted-tree
    // screen; variance is a different, flat "which line is worst" question.
    <Tabs defaultValue={tab === "variance" ? "variance" : "boq"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="boq">BOQ</TabsTrigger>
        <TabsTrigger value="variance">Cost Variance</TabsTrigger>
      </TabsList>
      <TabsContent value="boq">
        <ScopeClient projectId={projectId} listColumns={boqListColumns} initial={list} />
      </TabsContent>
      <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]">
        <CostVarianceAnalyticalClient projectId={projectId} />
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
