import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";

export default async function WorkProgressPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      {/* R67 A-04: this pane shows ONE project's entries, so the rail and the
          composer must name that project rather than "All projects". When the
          URL did not name it, the page picked it -- and says so, which is why
          the source is published and not just the id. */}
      <ScreenContext
        moduleId="work-progress"
        project={project}
        source={projectId && project?.id === projectId ? "route" : "auto"}
      />
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
            <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressPageClient projectId={project.id} /></TabsContent>
            <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressAnalyticalClient projectId={project.id} /></TabsContent>
            <TabsContent value="report"><WorkProgressReportClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
