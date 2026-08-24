import PermitCreateClient from "@/components/PermitCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";

// R42 seq21: PERMITS.OBJECT create mode. Deliberate scope note (evidence,
// not silent deviation): creation goes through the EXISTING multipart
// POST /api/permits (Wave 143, already real+working -- a required PDF
// upload doesn't fit the generic JSON screen_drafts payload M29 defines),
// not the new draft-lifecycle machinery. The new OBJECT-screen draft
// lifecycle (Edit -> autosave -> leave/return -> reload -> Save) that seq21
// actually introduces is proven on the EDIT path in permits/[id] instead.
export default async function NewPermitPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId: qsProjectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(qsProjectId, organizationId);

  if (errorMessage || !project) {
    return (
      <main className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </main>
    );
  }

  return (
    <main className="flex-1 p-6">
      <PermitCreateClient projectId={project.id} />
    </main>
  );
}
