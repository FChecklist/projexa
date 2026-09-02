import DocumentUploadClient from "@/components/DocumentUploadClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Real-screen conversion (2026-08-30): replaces the old "Upload Document"
// Dialog popup with a real create route.
export default async function DocumentUploadPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  // R67 D-70 (audit R-262): this used to `return` a bare Card holding
  // resolveSelectedProject's raw message, so an upstream failure replaced the
  // whole right pane with a bare HTTP status phrase -- no title, no Back, no
  // Retry, and no statement of what had failed. The screen's own frame is
  // rendered in every case now, with the failure reported inside it and a
  // Retry that re-runs the server fetch.
  if (errorMessage || !project) {
    return (
      <div className="flex-1">
        <CreateScreenUnavailable
          breadcrumb="Documents / New Document"
          title="New Document"
          backHref="/documents"
          backLabel="Back to Documents"
          message={errorMessage}
        />
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
