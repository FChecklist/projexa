import PermitCreateClient from "@/components/PermitCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import CreateScreenUnavailable from "@/components/CreateScreenUnavailable";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

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
          breadcrumb="Permits / New Permit"
          title="New Permit"
          backHref="/permits"
          backLabel="Back to Permits"
          message={errorMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      {/* R67 D-06: the name goes down with the id so the screen can state
          "For project: <name>" under its title -- a create screen must say
          where the record it is about to write will land. */}
      <PermitCreateClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
