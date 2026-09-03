import { PageHeading } from "@/components/PageHeading";
import ProjectLoadError from "@/components/ProjectLoadError";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DesignStudioTimesheetClient from "@/components/DesignStudioTimesheetClient";
import { isoDate } from "@/lib/work-progress-report-params";

// R67 D-07 -- the Design Studio timesheet, decision D-07: "A day grid, one row
// per task, in Sumeet's exact columns Date | Project | Category | Task | Hours
// with status at row level (Draft / Submitted / Approved / Sent back); the week
// view is a filter over the same rows, not a second grid."
//
// The route is new; the DATA is not. It reuses ScheduleTimesheetClient's data
// layer (GET /api/timesheets?projectId=, over compliance-tracker's
// pms-time-service.ts) rather than adding a second read of the same hours.
//
// Decision D-04, Option A: the project resolves server-side, so the org's
// VERIDIAN key never reaches the browser. `today` is resolved here too -- the
// week filter must not depend on the visitor's clock, which is the same
// hydration rule src/lib/format-date.ts pins its locale and time zone for.
export default async function DesignStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Design Studio" />
      {errorMessage && <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />}
      {!errorMessage && !project && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">
            Choose a project in the top bar to see its timesheet.
          </CardContent>
        </Card>
      )}
      {project && (
        <DesignStudioTimesheetClient
          projectId={project.id}
          projectName={project.name}
          today={isoDate(new Date())}
        />
      )}
    </div>
  );
}
