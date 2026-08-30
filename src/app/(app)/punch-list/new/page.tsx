import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import PunchListCreateClient from "@/components/PunchListCreateClient";

export default async function PunchListNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
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
      <PunchListCreateClient projectId={project.id} />
    </div>
  );
}
