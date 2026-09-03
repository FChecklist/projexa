import DesignStudioTimesheetObjectClient from "@/components/DesignStudioTimesheetObjectClient";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 WS-H (item H-01, decision D-11). One timesheet entry's object page:
// display-first, one explicit Edit, and a Delete that states its blast
// radius rather than asking "Are you sure?".
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
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

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
      <DesignStudioTimesheetObjectClient entryId={id} projectId={project.id} projectName={project.name} />
    </div>
  );
}
