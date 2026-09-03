import Link from "next/link";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DesignStudioCostAnalysisClient from "@/components/DesignStudioCostAnalysisClient";

// R67 E-16 (R-150). DESIGN STUDIO.
//
// compliance-tracker's designerTimesheetReport has computed four Budget-vs-
// Actual breakdowns since PR #597 -- by category, by designer, by project and
// by designer status -- and no PROJEXA screen showed a single one of them. Cost
// Analysis is that screen, and this route is where it lives.
//
// WHY THIS ROUTE EXISTS HERE. /design-studio existed only in compliance-tracker
// (its own src/app/(app)/design-studio/page.tsx); PROJEXA had no such route at
// all, so a "Cost Analysis tab on /design-studio" had nowhere to mount. The
// Timesheet tab below is DELIBERATELY a link to the screen that really holds
// the day grid today -- Schedule > Timesheet -- rather than a second, emptier
// copy of it: naming a tab and then rendering a placeholder under it is exactly
// the "not yet viewable here" defect this whole workstream is closing. When the
// Design Studio timesheet grid of binding decision D-07 lands, it replaces that
// link in place, and the Cost Analysis tab is untouched.
export default async function DesignStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string }>;
}) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Design Studio" />

      {errorMessage && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
        </Card>
      )}
      {!errorMessage && !project && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent>
        </Card>
      )}

      {project && (
        <Tabs defaultValue={tab === "timesheet" ? "timesheet" : "cost-analysis"} className="space-y-4">
          <TabsList>
            <TabsTrigger value="cost-analysis">Cost Analysis</TabsTrigger>
            <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
          </TabsList>
          <TabsContent value="cost-analysis">
            <DesignStudioCostAnalysisClient projectId={project.id} projectName={project.name} />
          </TabsContent>
          <TabsContent value="timesheet">
            <Card>
              <CardContent className="space-y-2 p-6 text-sm text-px-muted">
                <p>Designer time is logged and reviewed on the Schedule screen&apos;s Timesheet tab.</p>
                <Link
                  href={`/schedule?tab=timesheet&projectId=${encodeURIComponent(project.id)}`}
                  className="inline-flex text-px-teal underline"
                  data-testid="design-studio-timesheet-link"
                >
                  Open Schedule &gt; Timesheet
                </Link>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
