import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MeetingsClient from "@/components/MeetingsClient";

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Meetings" />
        {errorMessage && <Card className="border-px-error-border bg-px-error-light"><CardContent className="p-4 text-sm text-px-error">{errorMessage}</CardContent></Card>}
        {!errorMessage && !project && <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>}
        {project && <MeetingsClient projectId={project.id} />}
      </main>
    </>
  );
}
