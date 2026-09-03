import DesignStudioTimesheetClient from "@/components/DesignStudioTimesheetClient";
import { Card, CardContent } from "@/components/ui/card";
import ProjectLoadError from "@/components/ProjectLoadError";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { todayIso } from "@/lib/design-studio-timesheet";

// R67 D-07 -- the Design Studio timesheet, decision D-07: "A day grid, one row
// per task, in Sumeet's exact columns Date | Project | Category | Task | Hours
// with status at row level (Draft / Submitted / Approved / Sent back); the week
// view is a filter over the same rows, not a second grid."
//
// The route is new; the DATA is not. It reuses ScheduleTimesheetClient's data
// layer (GET /api/timesheets, over compliance-tracker's pms-time-service.ts)
// rather than adding a second read of the same hours. compliance-tracker has a
// route of the same name; that one is VERIDIAN's floor-plan and mood-board hub,
// a different screen entirely, and is deliberately not treated as this module
// having already shipped.
//
// Decision D-04, Option A: the project resolves server-side, so the org's
// VERIDIAN key never reaches the browser. `today` is resolved here too -- the
// grid's day must not depend on the visitor's clock, which is the same
// hydration rule src/lib/format-date.ts pins its locale and time zone for.
//
// MERGE NOTE (D-11): lane D0's page is the base -- its server-resolved `today`
// and its errorMessage / no-project / data states are kept verbatim. Lane H
// adds the project LIST (the add-row's Project select needs it) and the module's
// three tabs, which live inside the client.
export default async function DesignStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage) {
    return (
      <div className="flex-1 p-6">
        <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 p-6">
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">
            Choose a project in the top bar to see its timesheet.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DesignStudioTimesheetClient
        projectId={project.id}
        projectName={project.name}
        projects={projects}
        today={todayIso(new Date())}
      />
    </div>
  );
}
