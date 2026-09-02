import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns as resolveCachedRegistryColumns } from "@/lib/screen-definitions";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import ScopeClient, { SCOPE_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

// R44 seq3 (M28 registry-model proof): resolved server-side so ScopeClient
// never needs its own Bearer-key-authenticated fetch. A missing or errored
// registry row is NOT fatal -- ScopeClient falls back to its own hardcoded
// columns when this is null.
//
// R67 F-04: the body moved to src/lib/screen-definitions.ts, which adds the
// per-org unstable_cache every module page now shares (a registry row changes
// when somebody edits the registry, not on every navigation). This wrapper is
// kept because scope/[id]/compare/page.tsx imports it from here.
export async function resolveRegistryColumns(functionId: string, organizationId: string | null): Promise<RegistryColumn[] | null> {
  return resolveCachedRegistryColumns(functionId, organizationId, SCOPE_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>;
}

const SCOPE_COLUMNS_TTL_SECONDS = 600;

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Scope of Work (BOQ)" />
      <Suspense
        fallback={<TableLoadingRows headers={SCOPE_FALLBACK_COLUMN_LABELS} rows={6} caption="Loading BOQs..." delayMs={0} />}
      >
        <ScopeSection projectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}

async function ScopeSection({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  // R67 F-04: these two ran SERIALLY -- the project first, then the registry
  // row -- so the page paid both round trips end to end before sending any
  // HTML. Neither depends on the other.
  //
  // R46 P8 seq121: boq.custom is a CUSTOM-archetype row -- ScopeClient stays a
  // fully hand-built component (BOQ hierarchy/revisions/weighted sub-tasks are
  // too bespoke for a generic LIST renderer), but the main BOQ table's column
  // LABELS come from this registry row so they are editable with no redeploy.
  // Nothing about data fetching, row shape, or cell rendering is
  // registry-driven here.
  const [{ project, errorMessage }, boqListColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveRegistryColumns("boq.custom", organizationId),
  ]);

  return (
      <>
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          // R42 seq24: "variance" tab added -- DASHBOARD.PROJECT's own
          // "Budget vs Actual" KPI destination (?tab=variance from
          // DashboardProjectClient). The BOQ tab (ScopeClient) stays the
          // CUSTOM weighted-tree screen for editing/hierarchy; variance is
          // a different, flat "which line is worst" question.
          <Tabs defaultValue={tab === "variance" ? "variance" : "boq"} className="space-y-4">
            <TabsList>
              <TabsTrigger value="boq">BOQ</TabsTrigger>
              <TabsTrigger value="variance">Cost Variance</TabsTrigger>
            </TabsList>
            <TabsContent value="boq"><ScopeClient projectId={project.id} listColumns={boqListColumns} /></TabsContent>
            <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]"><CostVarianceAnalyticalClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </>
  );
}
