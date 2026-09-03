// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the serial chain no longer runs before the first byte and the
// frame streams first.
//
// Priority 17 follow-on (projexa_reports_dispatch_2026_07_16): ReportsClient is
// ALWAYS rendered, projectId nullable. Only its "Project Reports" tab needs a
// project; the org-wide "Full Catalog" tab (report_definitions) does not, and
// gating the whole page on a project used to hide it from any org that had not
// created one yet.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import ProjectLoadError from "@/components/ProjectLoadError";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ReportsClient from "@/components/ReportsClient";

// Reports has no list table of its own -- a picker and a result panel -- so
// the skeleton is five placeholder bars under the real tab labels.
const SKELETON = <ModuleListSkeletonBody columns={[]} tabs={["Project Reports", "Full Catalog"]} />;

async function ReportsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ projectId, projectName, errorMessage }, registryColumns] = await Promise.all([
    resolveProjectForModule(requestedProjectId, organizationId),
    // R46 P8 seq126: REPORT archetype ("reports.report") -- only the picker's
    // report LABELS are registry-driven; execution stays hand-built.
    getScreenColumns("reports.report", organizationId),
  ]);

  return (
    <>
      {/* R52 GATE 2 fix for F_026: this used to be an INERT error card -- it
          named the failure and left the user with nothing to do about it, on a
          page whose Project Reports tab is unusable until the project
          resolves. ProjectLoadError keeps the backend's own words and adds the
          retry. */}
      {errorMessage && <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />}
      <ReportsClient
        key={projectId ?? "no-project"}
        projectId={projectId}
        // R67 E-13: the title block names the project in words, so the card
        // never prints a raw cuid at the reader.
        projectName={projectName ?? (projectId ? await getProjectName(projectId, organizationId) : null)}
        registryColumns={registryColumns}
      />
    </>
  );
}

// R67 E-09 (R-128): every parameter a run is made of is read here and handed
// to the panel as its initial state, so a link to a run OPENS on that run.
// They stay a QUERY on /reports rather than becoming /reports/<slug> dynamic
// segments -- src/lib/nav-routes.ts's SHIPPED_ROUTES stays exact, and the
// deep-link contract is what the recommendation needs, not a new route shape.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; report?: string; from?: string; to?: string; weekStart?: string }>;
}) {
  // R67 E-09 (R-128): report/from/to/weekStart stay in the URL and are read by
  // ReportsClient itself through useSearchParams -- ONE reader, so the run the
  // panel opens on and the run the URL names can never be two different things.
  // They are declared in the type below because this route really does carry
  // them and a reader may arrive with all four.
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Reports" />
      <Suspense fallback={SKELETON}>
        <ReportsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
