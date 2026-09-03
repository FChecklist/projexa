import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import SubmittalCreateClient from "@/components/SubmittalCreateClient";

export default async function SubmittalNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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
          breadcrumb="Submittals / New Submittal"
          title="New Submittal"
          backHref="/submittals"
          backLabel="Back to Submittals"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <SubmittalCreateClient projectId={project.id} />
    </div>
  );
}
