import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import SiteDiaryClient from "@/components/SiteDiaryClient";

export default async function SiteDiaryPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, fellBack } = await resolveSelectedProject(projectId, organizationId);

  // Owner-reported defect (work order PROJEXA-E2E-001, section 5 item 3):
  // "/site-diary -- Empty while Work Progress holds the same history."
  // Investigated end to end: construction-site-diary-service.ts's
  // listSiteDiaries(), called directly against the live Supabase project,
  // correctly returns real rows for org=projexa_demo_org /
  // project=projexa_demo_project ("Villa 21 - Whitefield") -- 5 diary
  // entries, alongside 35 real work-progress entries for the same project.
  // The table and the query were never empty or wrong.
  // The real defect: this screen never named which project it was showing.
  // resolveSelectedProject()'s documented, deliberate first-project fallback
  // (project-selection.ts) silently picks the org's alphabetically-first
  // project when nothing is asked for -- "Business Bay Corporate HQ", which
  // has zero seeded site-diary entries (and zero work-progress entries too).
  // /work-progress reaches its project differently (module-list-source.ts's
  // resolveProjectForModule, R67 F-18): it honours an explicit ?projectId=
  // from a project-scoped link (e.g. a dashboard card) WITHOUT writing the
  // rail's remembered-project cookie, so a visit to /work-progress?projectId=
  // <villa21> can correctly show real history while a later, plain sidebar
  // click to /site-diary (no ?projectId=, same session, cookie still unset)
  // silently falls back to the empty project -- the exact "holds the same
  // history" vs "empty" asymmetry reported, and the same underlying bug
  // class already fixed for /change-orders (PR #299): a guess presented as
  // fact. Same fix here: name the resolved project and admit the guess, per
  // the D-13/D-20/D-32 convention already shipped for Documents/Labour/
  // Drawings/MoMs/change-orders.
  const projectNameForHeading = project?.name ?? null;
  const contextNote = fellBack ? "(auto-selected)" : null;

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Site Diary" project={projectNameForHeading} contextNote={contextNote} />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <SiteDiaryClient projectId={project.id} projectName={project.name} resolvedByFallback={fellBack} />
        )}
      </div>
    </>
  );
}
