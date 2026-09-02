import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import PermitsListClient, { PERMITS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/PermitsListClient";

// R67 F-02/F-03 (R-018/R-021/R-030/R-035). Two costs, both paid before a byte
// of HTML was sent: resolveSelectedProject() went through VERIDIAN's 1.4-4.0 s
// /dashboard aggregate (it now uses the cheap /projects read), and the
// permits.list registry lookup was awaited serially after it. They are now one
// Promise.all behind <Suspense>, and the registry row -- which changes only
// when somebody edits the registry -- is cached per org for 5 minutes. Per
// D-04 both fetches stay in the server component so the VERIDIAN API key never
// reaches the browser.
const PERMITS_COLUMNS_TTL_SECONDS = 300;

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; withinDays?: string }> }) {
  const { projectId, withinDays } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Permits" />
      <Suspense
        fallback={<TableLoadingRows headers={PERMITS_FALLBACK_COLUMN_LABELS} rows={3} caption="Loading permits..." delayMs={0} />}
      >
        <PermitsSection projectId={projectId} withinDays={withinDays} />
      </Suspense>
    </div>
  );
}

async function PermitsSection({ projectId, withinDays }: { projectId?: string; withinDays?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveRegistryColumns("permits.list", organizationId, PERMITS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
  ]);

  if (errorMessage) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
      </Card>
    );
  }
  if (!project) {
    return <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>;
  }
  // R42 seq24: DASHBOARD.PROJECT's own "Permits expiring" KPI must land here
  // PRE-FILTERED (GLOBAL: filters carried through a KPI click), not on the
  // unfiltered list -- withinDays passes straight through to the same
  // /api/permits?withinDays= param the KPI count itself used, so the two
  // always agree.
  return <PermitsListClient projectId={project.id} withinDays={withinDays} registryColumns={registryColumns} />;
}
