import { PageHeading } from "@/components/PageHeading";
import ProjectLoadError from "@/components/ProjectLoadError";
import { ProjexaLinkListCard } from "@/components/screens/ProjexaLinkListCard";
import { analysisScreens } from "@/lib/analysis-screens";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 E-27 (R-213). The destination the Analysis leaf never had.
//
// Analysis is one of the shell's fourteen entry points, and its first click
// landed nowhere at all -- the pill catalogue only learns a function id after
// a user has already used the pill once, so the very click that a reader makes
// to find out what Analysis IS fell through to seeding the composer draft with
// the word. Meanwhile four real analytical screens existed, each buried as a
// tab inside a different module.
//
// This page is that list. It is a server component for the same reason every
// other module page here is one: the project resolves server-side (D-04), so
// the destinations already carry ?projectId= when the reader clicks them and
// no screen has to re-resolve it in the browser.
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const screens = analysisScreens(project?.id ?? null);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Analysis" />
      {errorMessage && <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />}
      <p className="text-sm text-px-muted">
        {project
          ? `Every chart below is scoped to ${project.name}.`
          : "No project is selected, so these screens will open unscoped — pick a project in the top rail first."}
      </p>
      <div className="max-w-2xl">
        <ProjexaLinkListCard
          title="Analytical screens"
          items={screens.map((screen) => ({
            label: screen.label,
            href: screen.href,
            description: screen.description,
            note: screen.needsProject ? "Opens without a project until one is selected." : undefined,
          }))}
        />
      </div>
    </div>
  );
}
