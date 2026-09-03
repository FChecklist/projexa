import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import AttendanceCreateClient from "@/components/AttendanceCreateClient";

// R67 D-53: the Daily Summary's empty state links here for the day it was
// showing, so the form opens on THAT date rather than silently on today --
// otherwise the one click from "No attendance marked for 28-08-2026" would
// record the mark against the wrong day.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AttendanceNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string; date?: string }> }) {
  const { projectId, date } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">{errorMessage ?? "No active projects yet."}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <AttendanceCreateClient projectId={project.id} initialDate={date && ISO_DATE.test(date) ? date : undefined} />
    </div>
  );
}
