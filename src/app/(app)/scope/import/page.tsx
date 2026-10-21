import ScopeImportClient from "@/components/ScopeImportClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { PageHeading } from "@/components/PageHeading";
import { NoProjectGuide } from "@/components/NoProjectGuide";

// R67 D-25 x R67 lane D22 (item D-52, rec R-176): the screen the shipped BOQ
// importer never had. Thin pass-through -- all behaviour lives in
// ScopeImportClient, and the whole parse (preview included) happens on the
// VERIDIAN side, so PROJEXA gains no XLSX library.
//
// Project resolution is scope/page.tsx's own rule (?projectId= wins over the
// rail) through the shared resolveSelectedProject helper, so the "Import"
// action on /scope carries the selected project straight through.
//
// MERGE NOTE: same call as /labour/import -- D22's PickProjectPrompt replaces
// "No active project selected.", because a screen that names the next action is
// the audit's own recommendation, while a real LOAD failure still says what
// failed rather than being flattened into "pick a project".
export default async function ScopeImportPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Import BOQ from Excel" />
      {/* GUIDED ERRORS (G1): why no project could be found, what to do, and the exact place to do it */}
      {errorMessage && <NoProjectGuide kind="load-failed" message={errorMessage} />}
      {!errorMessage && !project && <NoProjectGuide kind="none-chosen" moduleLabel="BOQs" />}
      {project && <ScopeImportClient projectId={project.id} />}
    </div>
  );
}
