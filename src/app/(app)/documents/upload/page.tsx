import DocumentUploadClient from "@/components/DocumentUploadClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";

// Real-screen conversion (2026-08-30): replaces the old "Upload Document"
// Dialog popup with a real create route.
export default async function DocumentUploadPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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

  // R67 D-13: the project NAME goes through too, so the create screen can show
  // "Project: <name>" as a facet -- where the file will land, stated before the
  // file is chosen rather than after it is filed.
  return (
    <div className="flex-1">
      <DocumentUploadClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
