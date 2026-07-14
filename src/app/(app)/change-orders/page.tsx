import { AppTopbar } from "@/components/AppTopbar";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ChangeOrdersClient from "@/components/ChangeOrdersClient";

export default async function ChangeOrdersPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <AppTopbar title="Change Orders" />
      <main className="flex-1 space-y-6 p-6">
        {errorMessage && <Card className="border-px-error-border bg-px-error-light"><CardContent className="p-4 text-sm text-px-error">{errorMessage}</CardContent></Card>}
        {!errorMessage && !project && <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>}
        {project && <ChangeOrdersClient projectId={project.id} />}
      </main>
    </>
  );
}
