import DesignStudioTimesheetClient from "@/components/DesignStudioTimesheetClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 WS-H (items H-01/H-03/H-04, decision D-07). The Design Studio module's
// "My timesheet" tab -- PROJEXA's own /design-studio, which did not exist
// here at all. compliance-tracker has a route of the same name; that one is
// VERIDIAN's floor-plan and mood-board hub, a different screen entirely, and
// is deliberately not treated as this module having already shipped.
//
// The project is resolved SERVER-SIDE (D-04 option A): the VERIDIAN API key
// stays on the server, and the client component never makes a second hop
// just to learn which project it is looking at.
export default async function DesignStudioPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-8 text-center text-sm text-px-error">
            {errorMessage ?? "No active project selected. Pick a project to open its Design Studio timesheet."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DesignStudioTimesheetClient projectId={project.id} projectName={project.name} projects={projects} />
    </div>
  );
}
