// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the serial getServerOrganizationId() -> VERIDIAN /dashboard chain
// no longer runs before the first byte. The project id comes from ?projectId=
// or the projexa_project cookie with no call at all, and the /dashboard hop
// survives only for the case where neither knew -- inside the boundary, with
// the frame already on screen.
//
// R67 MERGE (lane D0 x lane F2). Lane D0 added two things to this page that
// F2's version did not have, and both are kept:
//
//   * D-02's REPORT PARAMETERS. from / to / view / boqVersion are resolved
//     here, server-side, and handed to the Report tab, which runs on arrival
//     with them (correction C-04). A link from the Reports module, a bookmark
//     and a reload all reproduce the same report.
//   * D-65's PROJECT NAME on both panes, so a waiting pane can say "Loading
//     progress entries for Cedar Heights Villa - Phase 1..." rather than
//     narrating an opaque uuid or nothing at all.
//
// The entries/activities fan-out inside WorkProgressPageClient IS addressed
// now -- that is F-24, and it landed in work-progress-reads.ts and the three
// clients rather than here.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { WORK_PROGRESS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { getProjectName, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { parseWprParams } from "@/lib/work-progress-report-params";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";
// R67 A-04: this pane shows ONE project's entries, so the rail and the composer
// must name that project -- and say when the page picked it rather than the
// user. Published inside the boundary (see ModuleScreenContext's header).
import { ModuleScreenContext } from "@/components/ModuleScreenContext";

type WorkProgressSearchParams = {
  projectId?: string;
  tab?: string;
  from?: string;
  to?: string;
  view?: string;
  boqVersion?: string;
  // R67 D-28: `deleted` is the confirmation the entry's own object page hands
  // over when it deletes itself -- that page unmounts with the navigation, so
  // its own message band cannot carry it.
  deleted?: string;
};

const SKELETON = (
  <ModuleListSkeletonBody
    columns={WORK_PROGRESS_LIST_COLUMNS}
    tabs={["Daily Entry", "Analytics", "Report"]}
  />
);

async function WorkProgressSection({
  requestedProjectId,
  tab,
  reportParams,
  deletedNotice,
}: {
  requestedProjectId?: string;
  tab?: string;
  reportParams: ReturnType<typeof parseWprParams>;
  /** R67 D-28: the receipt the deleted entry's object page handed over. */
  deletedNotice?: string | null;
}) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, source } = await resolveProjectForModule(
    requestedProjectId,
    organizationId
  );
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  // R67 D-65 x F-18: this screen has no list read of its own to batch with (the
  // panes fetch their own), so the name is awaited here -- inside the Suspense
  // boundary, with the frame and the tab strip already on screen, and served
  // from the 60 s per-org cache the rail has usually filled already.
  const projectName = resolvedName ?? (await getProjectName(projectId, organizationId));

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
        {/* R67 D-65: the project's NAME goes down with its id, so a waiting
            pane can name what it is waiting for. */}
        <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]">
          <WorkProgressPageClient projectId={projectId} projectName={projectName} notice={deletedNotice ?? null} />
        </TabsContent>
        <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]">
          <WorkProgressAnalyticalClient projectId={projectId} projectName={projectName} />
        </TabsContent>
        <TabsContent value="report">
          <WorkProgressReportClient projectId={projectId} initialParams={reportParams} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default async function WorkProgressPage({
  searchParams,
}: {
  searchParams: Promise<WorkProgressSearchParams>;
}) {
  const { projectId, tab, from, to, view, boqVersion, deleted } = await searchParams;
  // R67 D-02: the Work Progress Report's four parameters are read from the URL
  // here, server-side. A malformed bookmark still shows the current month
  // rather than failing to run (parseWprParams's own rule).
  const reportParams = parseWprParams({ from, to, view, boqVersion }, new Date());

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Work Progress" />
      <Suspense fallback={SKELETON}>
        <WorkProgressSection
          requestedProjectId={projectId}
          tab={tab}
          reportParams={reportParams}
          deletedNotice={deleted ?? null}
        />
      </Suspense>
    </div>
  );
}
