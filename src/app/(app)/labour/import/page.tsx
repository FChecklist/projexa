import RosterImportClient from "@/components/RosterImportClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import PickProjectPrompt from "@/components/PickProjectPrompt";

// R67 D-34 x R67 lane D22 (item D-68, rec R-258): the bulk roster load, the
// third of the three imports (BOQ, programme, roster). Thin pass-through, same
// pattern as scope/import/page.tsx -- all behaviour lives in RosterImportClient,
// and the whole parse (preview included) happens on the VERIDIAN side, so
// PROJEXA gains no XLSX library.
//
// Project resolution is the one shared rule every project-scoped page uses
// (?projectId= in the URL wins over the rail), so the "Import" action on
// /labour carries the selected project straight through.
//
// MERGE NOTE: the two lanes differed only in what this page says when there is
// no project. D22's PickProjectPrompt is kept over "No active project
// selected.", because a screen that names the next action is the audit's own
// recommendation and the failure it replaces is a dead end; a real LOAD failure
// still says what failed, which the prompt alone would have hidden.
export default async function LabourImportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
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
  );
}
