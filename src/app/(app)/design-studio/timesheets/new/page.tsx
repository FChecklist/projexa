import DesignStudioTimesheetCreateClient from "@/components/DesignStudioTimesheetCreateClient";
import { CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { todayIso } from "@/lib/design-studio-timesheet";

// R67 WS-H (item H-01). "New Timesheet Entry" -- the real create route.
// /schedule/log-time is now an alias that redirects here carrying ?taskId=,
// so there is ONE screen for logging time instead of two that drift apart.
//
// R67 MERGE (D-11, lane D1 x lane H, 2026-09-03): the failure branch was a bare
// error Card -- no breadcrumb, no title, no way back -- which is exactly what
// D-70 exists to remove, and D1's own sweep in CreateScreenUnavailable.test.tsx
// caught it the moment the two lanes met. This route arrived with lane H after
// D1 had swept the create routes that existed then, so it was never in that
// sweep. It renders the framed failure now, like every other create route.
const FRAME = {
  breadcrumb: "Design Studio / New Timesheet Entry",
  title: "New Timesheet Entry",
  backHref: "/design-studio/timesheets",
  backLabel: "Back to Timesheets",
} as const;

export default async function NewTimesheetEntryPage({ searchParams }: { searchParams: Promise<{ projectId?: string; taskId?: string }> }) {
  const { projectId, taskId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <CreateProjectMissing
          message={errorMessage ?? "No active project selected. Pick a project before logging time."}
          {...FRAME}
        />
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
