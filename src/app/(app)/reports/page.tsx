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
import { getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import ReportsClient from "@/components/ReportsClient";

// Reports has no list table of its own -- a picker and a result panel -- so
// the skeleton is five placeholder bars under the real tab labels.
const SKELETON = <ModuleListSkeletonBody columns={[]} tabs={["Project Reports", "Full Catalog"]} />;

async function ReportsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ projectId, errorMessage }, registryColumns] = await Promise.all([
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
      <ReportsClient key={projectId ?? "no-project"} projectId={projectId} registryColumns={registryColumns} />
    </>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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
