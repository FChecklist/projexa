import ProjectLoadError from "@/components/ProjectLoadError";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import SiteMaterialsClient from "@/components/SiteMaterialsClient";

export default async function SiteMaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Site Materials" />
      {errorMessage && <ProjectLoadError message={errorMessage} />}
      {!errorMessage && !project && <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>}
      {project && <SiteMaterialsClient projectId={project.id} />}
    </div>
  );
}
