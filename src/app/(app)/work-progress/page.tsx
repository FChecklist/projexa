// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the serial getServerOrganizationId() -> VERIDIAN /dashboard chain
// no longer runs before the first byte. The project id comes from ?projectId=
// or the projexa_project cookie with no call at all, and the /dashboard hop
// survives only for the case where neither knew -- inside the boundary, with
// the frame already on screen.
//
// The entries/activities fan-out inside WorkProgressPageClient is NOT
// addressed here; resolving those names in the list payload is F-24.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { WORK_PROGRESS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";
// R67 A-04: this pane shows ONE project's entries, so the rail and the composer
// must name that project -- and say when the page picked it rather than the
// user. Published inside the boundary (see ModuleScreenContext's header).
import { ModuleScreenContext } from "@/components/ModuleScreenContext";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={WORK_PROGRESS_LIST_COLUMNS}
    tabs={["Daily Entry", "Analytics", "Report"]}
  />
);

async function WorkProgressSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage, source } = await resolveProjectForModule(
    requestedProjectId,
    organizationId
  );
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  return (
    <>
    <ModuleScreenContext
      moduleId="work-progress"
      projectId={projectId}
      organizationId={organizationId}
      source={source}
    />
    {/* R42 seq24: "analytics" is DASHBOARD.PROJECT's own destination for the
        "% Complete by Value" and category-bar KPIs (?tab=analytics), so
        defaultValue reads the real ?tab= and a dashboard click lands directly
        on it rather than on Daily Entry first. */}
    <Tabs defaultValue={tab === "analytics" || tab === "report" ? tab : "entry"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="entry">Daily Entry</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="report">Report</TabsTrigger>
      </TabsList>
      <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]">
        <WorkProgressPageClient projectId={projectId} />
      </TabsContent>
      <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]">
        <WorkProgressAnalyticalClient projectId={projectId} />
      </TabsContent>
      <TabsContent value="report">
        <WorkProgressReportClient projectId={projectId} />
      </TabsContent>
    </Tabs>
    </>
  );
}

export default async function WorkProgressPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Work Progress" />
      <Suspense fallback={SKELETON}>
        <WorkProgressSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
