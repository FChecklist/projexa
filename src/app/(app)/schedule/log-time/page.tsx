import ScheduleLogTimeClient from "@/components/ScheduleLogTimeClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";

// Real-screen conversion (2026-08-30): replaces the old Timesheet "Log Time"
// Dialog popup with a real create route.
export default async function ScheduleLogTimePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  // R67 D-51: the project's NAME goes down with its id, so the form can print
  // "Project: <name> — change in the top bar" instead of leaving the user to
  // guess whether the top rail and the rows they are about to write agree.
  return (
    <div className="flex-1">
      <ScheduleLogTimeClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
