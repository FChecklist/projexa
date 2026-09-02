import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import RosterImportClient from "@/components/RosterImportClient";
import PickProjectPrompt from "@/components/PickProjectPrompt";

// R67 lane D22 (item D-68, rec R-258): the labour roster import screen, the
// third of the three (BOQ, programme, roster). Project resolution is the same
// rule every other project-scoped page uses (?projectId= in the URL wins over
// the rail) through the shared resolveSelectedProject helper, so the "Import"
// action on /labour carries the selected project straight through.
export default async function LabourImportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Import roster" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && <PickProjectPrompt message="Pick a project in the top rail to import a roster into it" />}
        {project && <RosterImportClient projectId={project.id} />}
      </div>
    </>
  );
}
