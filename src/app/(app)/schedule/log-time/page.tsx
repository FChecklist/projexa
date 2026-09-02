import ScheduleLogTimeClient from "@/components/ScheduleLogTimeClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveScheduleTasks } from "@/lib/schedule-reference";
import { Card, CardContent } from "@/components/ui/card";

// Real-screen conversion (2026-08-30): replaces the old Timesheet "Log Time"
// Dialog popup with a real create route.
//
// R67 F-09 (R-122), D-04: the project's task list is resolved HERE and handed
// to the form as a prop. It used to be fetched from the browser after
// hydration, so the Task select -- the only field on this form that cannot be
// typed, and the one the whole screen exists to pick -- rendered empty and
// filled in a round trip later. The task list depends on the project, so this
// one is genuinely serial; the project resolve is cached for 60 s.
export default async function ScheduleLogTimePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId, { cacheSeconds: 60 });

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  const tasks = await resolveScheduleTasks(project.id, organizationId);

  return (
    <div className="flex-1">
      <ScheduleLogTimeClient projectId={project.id} tasks={tasks} />
    </div>
  );
}
