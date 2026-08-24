import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ScopeClient from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Scope of Work (BOQ)" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          // R42 seq24: "variance" tab added -- DASHBOARD.PROJECT's own
          // "Budget vs Actual" KPI destination (?tab=variance from
          // DashboardProjectClient). The BOQ tab (ScopeClient) stays the
          // CUSTOM weighted-tree screen for editing/hierarchy; variance is
          // a different, flat "which line is worst" question.
          <Tabs defaultValue={tab === "variance" ? "variance" : "boq"} className="space-y-4">
            <TabsList>
              <TabsTrigger value="boq">BOQ</TabsTrigger>
              <TabsTrigger value="variance">Cost Variance</TabsTrigger>
            </TabsList>
            <TabsContent value="boq"><ScopeClient projectId={project.id} /></TabsContent>
            <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]"><CostVarianceAnalyticalClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </main>
    </>
  );
}
