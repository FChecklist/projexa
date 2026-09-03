import DesignStudioCostAnalysisClient from "@/components/DesignStudioCostAnalysisClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 WS-H (items H-03/H-04). Budget vs Actual for design hours, rendered
// from VERIDIAN's existing designerTimesheetReport. This route adds a
// screen, never a second calculation of a number that already has one.
export default async function DesignStudioCostAnalysisPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-8 text-center text-sm text-px-error">
            {errorMessage ?? "No active project selected. Pick a project to see its design cost analysis."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DesignStudioCostAnalysisClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
