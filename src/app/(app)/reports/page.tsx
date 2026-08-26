import { PageHeading } from "@/components/PageHeading";
import ProjectLoadError from "@/components/ProjectLoadError";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ReportsClient, { type RegistryColumn } from "@/components/ReportsClient";

// R46 P8 seq126 (M28 registry-model proof, REPORT archetype -- function_id
// "reports.report"): same shape as R43 seq2's resolvePermitsListColumns and
// R46 P8 seq121's boq.custom lookup on /scope. ReportsClient's own report
// EXECUTION (fixed 17-report picker + weekly-project param + the org-wide
// Full Catalog tab over report_definitions) has real complexity a generic
// registry renderer can't represent, so it stays a fully hand-built
// component, same rationale as boq.custom for ScopeClient -- only the
// picker's report LABELS are registry-driven here. A missing or errored
// registry row is NOT fatal -- ReportsClient falls back to its own
// hardcoded labels when this is null.
async function resolveReportsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/reports.report", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[reports/page] screen_definitions resolve failed, falling back to hardcoded labels:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveReportsListColumns(organizationId);

  // Priority 17 follow-on (projexa_reports_dispatch_2026_07_16): previously
  // this page refused to render ReportsClient at all when the org had no
  // projects yet, which would have also hidden the new org-wide "Full
  // Catalog" tab (report_definitions catalog -- does not need a project) --
  // a real regression for any org that has not created a project yet.
  // ReportsClient is now always rendered (projectId nullable); only its
  // "Project Reports" tab needs a project, and it shows its own honest
  // empty state when there is not one, instead of the whole page.
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Reports" />
        {/* R52 GATE 2 fix for F_026's second route. This was an INERT error
            card: it named the failure and then left the user with nothing to
            do about it, on a page whose Project Reports tab is unusable until
            the project resolves. ProjectLoadError keeps the backend's own
            words and adds the retry, the same control the other 23
            project-scoped pages already got. */}
        {errorMessage && <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />}
        <ReportsClient key={project?.id ?? "no-project"} projectId={project?.id ?? null} registryColumns={registryColumns} />
      </div>
    </>
  );
}
