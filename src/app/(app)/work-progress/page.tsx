import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";

export default async function WorkProgressPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Work Progress" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <Tabs defaultValue="entry" className="space-y-4">
            <TabsList>
              <TabsTrigger value="entry">Daily Entry</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
            </TabsList>
            <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressPageClient projectId={project.id} /></TabsContent>
            <TabsContent value="report"><WorkProgressReportClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </main>
    </>
  );
}
