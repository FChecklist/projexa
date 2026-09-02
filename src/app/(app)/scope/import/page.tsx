import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ScopeImportClient from "@/components/ScopeImportClient";
import PickProjectPrompt from "@/components/PickProjectPrompt";

// R67 lane D22 (item D-52, rec R-176): the screen the shipped BOQ importer has
// never had. Project resolution is scope/page.tsx's own rule (?projectId= wins
// over the rail) through the shared resolveSelectedProject helper, so the
// "Import" action on /scope carries the selected project straight through.
export default async function ScopeImportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Import BOQ from Excel" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && <PickProjectPrompt message="Pick a project in the top rail to import a BOQ into it" />}
        {project && <ScopeImportClient projectId={project.id} />}
      </div>
    </>
  );
}
