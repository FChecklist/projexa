import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import LabourClient, { LABOUR_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/LabourClient";

// R67 F-06 (R-088/R-094). This page measured TTFB 2006 ms for a roster that
// the backend answers in milliseconds. None of that was the data: page.tsx
// awaited resolveSelectedProject() and THEN the manpower.list
// screen-definitions lookup, serially, before sending a single byte of HTML.
//
// Three changes, in the order they matter:
//   1. the heading is outside <Suspense>, so the frame streams immediately and
//      the reader sees the screen they navigated to, not a blank tab;
//   2. the two lookups run in ONE Promise.all -- neither depends on the other;
//   3. both are memoised per org (Next's Data Cache): the project list for
//      60 s, the registry row for 60 s. Per D-04 the fetch stays in the server
//      component, so the VERIDIAN API key never reaches the browser.
//
// The <Suspense> fallback carries the REAL column headers, so nothing on
// screen moves when the roster lands.
const LABOUR_LOOKUP_TTL_SECONDS = 60;

export default async function LabourPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Manpower & Attendance" />
      <Suspense
        fallback={
          <TableLoadingRows
            headers={LABOUR_FALLBACK_COLUMN_LABELS}
            rows={4}
            caption="Loading the roster…"
            // 0, not 150: this fallback only shows while the server component
            // is genuinely still fetching, so there is nothing to debounce --
            // delaying it would just mean a blank card instead.
            delayMs={0}
          />
        }
      >
        <LabourSection projectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}

async function LabourSection({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId, { cacheSeconds: LABOUR_LOOKUP_TTL_SECONDS }),
    resolveRegistryColumns("manpower.list", organizationId, LABOUR_LOOKUP_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
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
  return <LabourClient projectId={project.id} registryColumns={registryColumns} initialTab={tab} />;
}
