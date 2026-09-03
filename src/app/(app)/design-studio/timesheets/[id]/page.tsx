import DesignStudioTimesheetObjectClient from "@/components/DesignStudioTimesheetObjectClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 WS-H (item H-01, decision D-11). One timesheet entry's object page:
// display-first, one explicit Edit, and a Delete that states its blast
// radius rather than asking "Are you sure?".
//
// FIX PASS -- THE PROJECT COMES FROM THE ENTRY, NOT FROM THE DEFAULT.
// resolveSelectedProject(undefined, orgId) falls back to `projects[0]`
// (src/lib/project-selection.ts). So with the Design Studio open on any project
// other than the org's first, clicking a row used to open an object page whose
// breadcrumb read "Design Studio / <wrong project> / Timesheet" and whose
// "Project" facet named that wrong project -- a facet asserting a fact that is
// false, which is worse than showing nothing. The whole project LIST is handed
// down now, and the client labels itself from the entry's own projectId (which
// getTimeEntry already returns), falling back to the resolved default only for
// an entry whose task carries no project at all.
export default async function TimesheetEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { id } = await params;
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-8 text-center text-sm text-px-error">
            {errorMessage ?? "No active project selected."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DesignStudioTimesheetObjectClient
        entryId={id}
        projectId={project.id}
        projectName={project.name}
        projects={projects}
      />
    </div>
  );
}
