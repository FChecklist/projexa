import ScopeImportClient from "@/components/ScopeImportClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";

// R67 D-25: the screen the shipped BOQ importer never had. Thin pass-through,
// same pattern as scope/new/page.tsx -- all behaviour lives in
// ScopeImportClient, and the whole parse (preview included) happens on the
// VERIDIAN side, so PROJEXA gains no XLSX library.
export default async function ScopeImportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <ScopeImportClient projectId={project.id} />
    </div>
  );
}
