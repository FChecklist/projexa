import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import MaterialsClient, { MATERIALS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/MaterialsClient";

// Point 33: repointed to a real project-scoped material master + receipts
// (was org-wide ERP ledger listing only, no create path) -- same
// resolveSelectedProject pattern as moms/page.tsx.
//
// R67 F-07 (R-100/R-106). Warm /materials measured TTFB 2006 ms and LCP
// 3244 ms for a two-row table, because this page resolved the org, then the
// project, then the screen definitions -- serially -- before sending any HTML.
//
//   1. the heading streams first; only the data-dependent subtree is behind
//      <Suspense>, and its fallback carries the real column headers;
//   2. the project and the registry row resolve in ONE Promise.all;
//   3. both are memoised per org in Next's Data Cache. The material.list
//      registry row changes when somebody edits the registry, i.e. almost
//      never, so it gets 10 minutes; the project list gets 60 s, which is what
//      the rail's own selection is worth.
//
// Per D-04 the fetch stays in the server component: the VERIDIAN API key never
// reaches the browser.
const MATERIALS_COLUMNS_TTL_SECONDS = 600;
const PROJECT_TTL_SECONDS = 60;

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Materials" />
      <Suspense
        fallback={
          <TableLoadingRows
            headers={MATERIALS_FALLBACK_COLUMN_LABELS}
            rows={3}
            caption="Loading materials…"
            // 0, not 150: this fallback only shows while the server component
            // is genuinely still fetching, so there is nothing to debounce.
            delayMs={0}
          />
        }
      >
        <MaterialsSection projectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}

async function MaterialsSection({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId, { cacheSeconds: PROJECT_TTL_SECONDS }),
    resolveRegistryColumns("material.list", organizationId, MATERIALS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
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
  return <MaterialsClient projectId={project.id} registryColumns={registryColumns} initialTab={tab} />;
}
