import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import ProjectLoadError from "@/components/ProjectLoadError";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
//
// R67 F-10 (R-134). This is a screen with one select and one button, and it
// took eight blocking calls to become usable -- among them the project resolve
// and the registry lookup, awaited serially before any HTML was sent.
//
//   1. the heading and the shape of the parameter card stream first; only the
//      data-dependent subtree is behind <Suspense>;
//   2. the project and the registry row resolve in ONE Promise.all;
//   3. the registry row is memoised per org for 10 minutes -- it is a static
//      registry row that only relabels the picker.
const REPORTS_COLUMNS_TTL_SECONDS = 600;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Reports" />
      <Suspense fallback={<ReportsParameterSkeleton />}>
        <ReportsSection projectId={projectId} />
      </Suspense>
    </div>
  );
}

// The shape of the real parameter card -- its label and the two controls --
// rather than a spinner, so the screen is recognisable in the first flush and
// nothing moves when the picker becomes live.
function ReportsParameterSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Report</p>
            <Skeleton className="h-9 w-64" />
          </div>
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
      <Card className="shadow-card">
        <CardContent className="p-4">
          <p role="status" className="py-10 text-center text-sm text-px-muted">Loading reports…</p>
        </CardContent>
      </Card>
    </div>
  );
}

async function ReportsSection({ projectId }: { projectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId, { cacheSeconds: 60 }),
    resolveRegistryColumns("reports.report", organizationId, REPORTS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
  ]);

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
      {/* R52 GATE 2 fix for F_026's second route. This was an INERT error
          card: it named the failure and then left the user with nothing to
          do about it, on a page whose Project Reports tab is unusable until
          the project resolves. ProjectLoadError keeps the backend's own
          words and adds the retry, the same control the other 23
          project-scoped pages already got. */}
      {errorMessage && <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />}
      <ReportsClient key={project?.id ?? "no-project"} projectId={project?.id ?? null} registryColumns={registryColumns} />
    </>
  );
}
