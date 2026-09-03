import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import PunchListCreateClient from "@/components/PunchListCreateClient";

export default async function PunchListNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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
          breadcrumb="Punch List / New Item"
          title="New Item"
          backHref="/punch-list"
          backLabel="Back to Punch List"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <PunchListCreateClient projectId={project.id} />
    </div>
  );
}
