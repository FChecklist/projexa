import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";
import { parseWprParams } from "@/lib/work-progress-report-params";

export default async function WorkProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; from?: string; to?: string; view?: string; boqVersion?: string }>;
}) {
  const { projectId, tab, from, to, view, boqVersion } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  // R67 D-02: the Work Progress Report's four parameters (from, to, view,
  // boqVersion) are resolved from the URL here, server-side, and handed to the
  // Report tab -- which runs on arrival with them (correction C-04). A link
  // from the Reports module, a bookmark and a reload all reproduce the same
  // report.
  const reportParams = parseWprParams({ from, to, view, boqVersion }, new Date());

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Work Progress" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {/* R42 seq24: "analytics" added as a real 3rd tab -- this is
            DASHBOARD.PROJECT's own destination for the "% Complete by
            Value" and category-bar KPIs (?tab=analytics from
            DashboardProjectClient). defaultValue reads the real ?tab= so a
            dashboard click lands directly on it, not on Daily Entry first. */}
        {project && (
          <Tabs defaultValue={tab === "analytics" || tab === "report" ? tab : "entry"} className="space-y-4">
            <TabsList>
              <TabsTrigger value="entry">Daily Entry</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
            </TabsList>
            {/* R67 D-65: the project's NAME goes down with its id, so a
                waiting pane can say "Loading progress entries for Cedar
                Heights Villa – Phase 1…" rather than narrating an opaque
                uuid or nothing at all. */}
            <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressPageClient projectId={project.id} projectName={project.name} /></TabsContent>
            <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressAnalyticalClient projectId={project.id} projectName={project.name} /></TabsContent>
            <TabsContent value="report"><WorkProgressReportClient projectId={project.id} initialParams={reportParams} /></TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
