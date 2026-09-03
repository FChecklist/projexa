import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";

// R67 E-28 (D-02): the Work Progress Report's parameters live in the URL --
// from, to, view and boqId next to projectId -- and they are read HERE, on the
// server, then passed in. Never through useSearchParams() in the client, which
// forces a Suspense bailout at build time for the whole subtree.
export default async function WorkProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; from?: string; to?: string; view?: string; boqId?: string }>;
}) {
  const { projectId, tab, from, to, view, boqId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

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
            <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressPageClient projectId={project.id} /></TabsContent>
            <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]"><WorkProgressAnalyticalClient projectId={project.id} /></TabsContent>
            <TabsContent value="report">
              <WorkProgressReportClient
                projectId={project.id}
                projectName={project.name}
                initialFrom={from ?? null}
                initialTo={to ?? null}
                initialView={view ?? null}
                initialBoqId={boqId ?? null}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
