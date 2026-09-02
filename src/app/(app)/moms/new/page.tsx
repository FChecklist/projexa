import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MoMCreateClient from "@/components/MoMCreateClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";

export default async function MoMNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, source } = await resolveSelectedProject(projectId, organizationId);

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
          breadcrumb="Minutes of Meeting / New MoM"
          title="New MoM"
          backHref="/moms"
          backLabel="Back to Minutes of Meeting"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      {/* R67 A-03: the create screen is inside one project too -- the shell's
          rail and strip must say which, not "All projects". */}
      <ScreenContext moduleId="moms" project={project} source={source ?? "auto"} />
      <MoMCreateClient projectId={project.id} />
    </div>
  );
}
