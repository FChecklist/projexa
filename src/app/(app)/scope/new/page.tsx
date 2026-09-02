import ScopeCreateClient from "@/components/ScopeCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Real-screen conversion (2026-08-30): replaces the old "New BOQ" Dialog
// popup with a real create route, same thin pass-through pattern as
// permits/[id]/page.tsx.
export default async function ScopeNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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
          breadcrumb="Scope of Work / New BOQ"
          title="New BOQ"
          backHref="/scope"
          backLabel="Back to Scope of Work"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <ScopeCreateClient projectId={project.id} />
    </div>
  );
}
