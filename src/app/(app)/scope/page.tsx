import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ScreenLoading from "@/components/ScreenLoading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";
import ScopeClient, { type RegistryColumn } from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

// R44 seq3 (M28 registry-model proof, same pattern as permits/page.tsx's
// resolvePermitsListColumns): resolved server-side so ScopeClient never
// needs its own Bearer-key-authenticated fetch. A missing or errored
// registry row is NOT fatal -- ScopeClient falls back to its own hardcoded
// columns when this is null. R46 P8 seq121 factored the body out to a
// shared helper so the new boq.custom lookup (main BOQ table's column
// labels -- CUSTOM archetype, see below) didn't duplicate this try/catch.
export async function resolveRegistryColumns(functionId: string, organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>(`/screen-definitions/${functionId}`, {
      organizationId: organizationId ?? undefined,
      // R67 D-04: a label lookup must never be what keeps a module page blank.
      timeoutMs: VERIDIAN_SCREEN_BUDGET_MS,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error(`[scope/page] screen_definitions resolve failed for ${functionId}, falling back to hardcoded columns:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 D-04 -- Option A, applied to the slowest page the R66 audit measured
// (/scope, ~8 s). The project resolution and the boq.custom label lookup were
// awaited one after the other despite being independent; they now run
// concurrently, behind a <Suspense> boundary so the heading and the tab strip
// stream immediately and the wait is a skeleton in the shape of the BOQ table
// rather than a blank frame. The VERIDIAN key never leaves the server.
async function ScopeBody({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, boqListColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    // R46 P8 seq121: boq.custom is a CUSTOM-archetype row -- ScopeClient stays
    // a fully hand-built component (BOQ hierarchy/revisions/weighted sub-tasks
    // are too bespoke for a generic LIST renderer), but the main BOQ table's
    // column LABELS now come from this registry row so they're editable with
    // no redeploy, same as every other converted screen. Nothing about data
    // fetching, row shape, or cell rendering is registry-driven here.
    resolveRegistryColumns("boq.custom", organizationId), // never rejects
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
          {/* R67 D-65: the project's name travels with its id so the pane can
              name what it is waiting for, and the empty sentence can name the
              project it is empty FOR. */}
          <TabsContent value="boq"><ScopeClient projectId={project.id} projectName={project.name} listColumns={boqListColumns} /></TabsContent>
          <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]"><CostVarianceAnalyticalClient projectId={project.id} /></TabsContent>
        </Tabs>
      )}
    </>
  );
}

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Scope of Work (BOQ)" />
        <Suspense fallback={<ScreenLoading entity="the BOQ" rows={6} columns={6} />}>
          <ScopeBody projectId={projectId} tab={tab} />
        </Suspense>
      </div>
    </>
  );
}
