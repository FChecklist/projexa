import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import WorkProgressEntryObjectClient from "@/components/WorkProgressEntryObjectClient";

// R67 D-67 -- the object page a logged progress entry never had. A Daily
// Entry row used to be the end of the road: it showed a truncated remark and
// a percentage, and the site photo attached to it was reachable from nowhere
// in the UI.
//
// The project comes from the URL, because there is no per-entry endpoint to
// resolve it from -- the entry is selected out of the project's own list (see
// WorkProgressEntryObjectClient's header for why that is the only real source
// available). Daily Entry rows link here carrying ?projectId=, which is also
// what makes this page bookmarkable.
export default async function WorkProgressEntryPage({
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
          <CardContent className="p-4 text-sm text-px-error">
            {errorMessage ?? "Choose a project in the top bar to open a progress entry."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <WorkProgressEntryObjectClient entryId={id} projectId={project.id} projectName={project.name} />;
}
