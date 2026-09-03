import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import MoMsClient, { MOMS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/MoMsClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";

// R67 F-03 (R-041/R-046/R-052/R-057). Measured TTFB 1983 ms for a three-column
// meeting list, none of it the list: this page awaited resolveSelectedProject()
// -- VERIDIAN's 1.4-4.0 s /dashboard aggregate -- and THEN the screen-
// definitions lookup, serially, before any HTML was sent. See
// documents/page.tsx's header for the full shape of the fix; this is the same
// one. The only difference is the cache window: moms.list is a settled
// registry row, so an hour, where documents.list takes ten minutes.
const MOMS_COLUMNS_TTL_SECONDS = 3600;

export default async function MoMsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Minutes of Meeting" />
      <Suspense
        fallback={
          <TableLoadingRows
            headers={MOMS_FALLBACK_COLUMN_LABELS}
            rows={3}
            caption="Loading meetings..."
            // 0, not 150: this only shows while a server component is still
            // fetching, so there is nothing to debounce.
            delayMs={0}
          />
        }
      >
        <MoMsSection projectId={projectId} />
      </Suspense>
    </div>
  );
}

async function MoMsSection({ projectId }: { projectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // Parallel, not serial -- neither lookup depends on the other.
  const [{ project, errorMessage, source }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveRegistryColumns("moms.list", organizationId, MOMS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
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
  return (
    <>
      {/* R67 A-03: tell the shell what this screen resolved, so the top rail
          and the composer's strip name the same project the pane is showing
          instead of reading "All projects" beside one project's meetings. */}
      <ScreenContext moduleId="moms" project={project} source={source ?? "auto"} />
      <MoMsClient projectId={project.id} registryColumns={registryColumns} />
    </>
  );
}
