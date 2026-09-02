import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import DocumentsClient, { DOCUMENTS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/DocumentsClient";

// R67 F-03 (R-041/R-046/R-052/R-057). This page measured TTFB 1951 ms for a
// simple document register, and none of it was the register: page.tsx awaited
// resolveSelectedProject() -- which called VERIDIAN's 1.4-4.0 s /dashboard
// aggregate -- and THEN awaited the screen-definitions lookup, serially,
// before sending a single byte of HTML.
//
// Three changes, in the order they matter:
//   1. resolveSelectedProject() now hits the cheap /projects endpoint (see
//      src/lib/project-selection.ts);
//   2. the two remaining lookups run in ONE Promise.all instead of serially --
//      neither depends on the other;
//   3. the whole data-dependent subtree is behind <Suspense>, so the heading
//      streams first and the reader sees the real column headers, not a blank
//      page, while the project resolves. Per D-04 the fetch stays in the
//      server component: the VERIDIAN API key never reaches the browser.
//
// The screen-definitions row is a registry row that changes when somebody
// edits the registry, so it is cached for 10 minutes per org (documents.list
// is actively being edited; moms.list, which is not, uses an hour).
const DOCUMENTS_COLUMNS_TTL_SECONDS = 600;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Documents" />
      <Suspense
        fallback={
          <TableLoadingRows
            headers={DOCUMENTS_FALLBACK_COLUMN_LABELS}
            rows={3}
            caption="Loading documents..."
            // 0, not 150: this fallback only ever shows while a server
            // component is genuinely still fetching, so there is nothing to
            // debounce -- delaying it would just mean a blank card instead.
            delayMs={0}
          />
        }
      >
        <DocumentsSection projectId={projectId} />
      </Suspense>
    </div>
  );
}

async function DocumentsSection({ projectId }: { projectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // Parallel, not serial: the column labels do not depend on which project is
  // selected, and the project does not depend on the labels.
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveRegistryColumns("documents.list", organizationId, DOCUMENTS_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
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
  return <DocumentsClient projectId={project.id} registryColumns={registryColumns} />;
}
