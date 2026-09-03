import DesignStudioTimesheetCreateClient from "@/components/DesignStudioTimesheetCreateClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { todayIso } from "@/lib/design-studio-timesheet";

// R67 WS-H (item H-01). "New Timesheet Entry" -- the real create route.
// /schedule/log-time is now an alias that redirects here carrying ?taskId=,
// so there is ONE screen for logging time instead of two that drift apart.
export default async function NewTimesheetEntryPage({ searchParams }: { searchParams: Promise<{ projectId?: string; taskId?: string }> }) {
  const { projectId, taskId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-8 text-center text-sm text-px-error">
            {errorMessage ?? "No active project selected. Pick a project before logging time."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      {/* `today` is resolved on the SERVER (lane D0's rule) so the default date
          is not the visitor's clock and cannot drift on hydration. */}
      <DesignStudioTimesheetCreateClient
        projectId={project.id}
        projectName={project.name}
        preselectedTaskId={taskId}
        today={todayIso(new Date())}
      />
    </div>
  );
}
