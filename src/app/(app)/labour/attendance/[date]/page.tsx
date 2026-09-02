import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import AttendanceSheetClient from "@/components/AttendanceSheetClient";

// R67 D-30: one day's attendance sheet. The date is a route segment rather
// than a query param so a sheet is a real, linkable, back-button-restorable
// place -- the Attendance tab's list of sheets links straight here.
//
// A static /labour/attendance/new segment takes precedence over this dynamic
// one in Next's own route matching, so the existing one-worker form is
// unaffected.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AttendanceSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { date } = await params;
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (!ISO_DATE.test(date) || Number.isNaN(new Date(date).getTime())) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <PageHeading title="Daily Attendance" breadcrumb="Manpower / Attendance" />
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">
            &quot;{date}&quot; is not a date. An attendance sheet is addressed as /labour/attendance/YYYY-MM-DD.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (errorMessage || !project) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <PageHeading title="Daily Attendance" breadcrumb="Manpower / Attendance" />
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">{errorMessage ?? "No active projects yet."}</CardContent>
        </Card>
      </div>
    );
  }

  return <AttendanceSheetClient projectId={project.id} projectName={project.name} attendanceDate={date} />;
}
