import DrawingCreateClient from "@/components/DrawingCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 D-08 (audit R-032). This page used to return EARLY -- a bare Card
// carrying resolveSelectedProject's raw errorMessage -- whenever the VERIDIAN
// /dashboard call failed. The whole right pane became the words "Internal
// Server Error": no title, no Back, no Retry, and no way to tell what had
// failed or what to do next. Correction C-06 records that the CAUSE of that
// failure was never established, so the fix cannot be conditional on the
// cause: this route now NEVER returns early. The screen renders in every
// case, and the failure is reported inside it.
//
// projectId comes from the search param FIRST (DrawingsClient always pushes
// ?projectId= when it opens this route), so a failed project-list resolution
// no longer costs the user the project they had already chosen -- the id is
// right there in the URL and the create call only needs the id. The name is
// resolved in the background by the client, and VERIDIAN scopes the id to the
// org on the write, so an id that is not this org's is refused there.
export default async function DrawingNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <div className="flex-1">
      <DrawingCreateClient
        projectId={projectId ?? project?.id ?? null}
        projectName={project?.name}
        projectError={errorMessage}
      />
    </div>
  );
}
