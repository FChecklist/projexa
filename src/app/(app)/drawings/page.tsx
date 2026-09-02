import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import DrawingsClient, { DRAWINGS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/DrawingsClient";

// R67 F-02/F-03 (R-018/R-021/R-030/R-035). Same two costs every project-scoped
// page here paid before any HTML was sent: resolveSelectedProject() went
// through VERIDIAN's 1.4-4.0 s /dashboard aggregate (now the cheap /projects
// read), and the screen-definitions lookup was awaited serially after it (now
// parallel, and cached per org for 5 minutes -- drawings.list is a settled
// registry row). The data-dependent subtree is behind <Suspense> so the
// heading and the real column headers paint first. Per D-04 the fetch stays
// in the server component: the VERIDIAN API key never reaches the browser.
const DRAWINGS_COLUMNS_TTL_SECONDS = 300;

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Drawings & 3D" />
      <Suspense
        fallback={
          <TableLoadingRows headers={DRAWINGS_FALLBACK_COLUMN_LABELS} rows={3} caption="Loading drawings..." delayMs={0} />
        }
      >
        <DrawingsSection projectId={projectId} />
      </Suspense>
    </div>
  );
}

async function DrawingsSection({ projectId }: { projectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveRegistryColumns("drawings.list", organizationId, DRAWINGS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
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
  return <DrawingsClient projectId={project.id} registryColumns={registryColumns} />;
}
