import ProjectLoadError from "@/components/ProjectLoadError";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ScopeClient, { type RegistryColumn } from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

// R44 seq3 (M28 registry-model proof, same pattern as permits/page.tsx's
// resolvePermitsListColumns): resolved server-side so ScopeClient never
// needs its own Bearer-key-authenticated fetch. A missing or errored
// registry row is NOT fatal -- ScopeClient falls back to its own hardcoded
// columns when this is null. R46 P8 seq121 factored the body out to a
// shared helper so the new boq.custom lookup (main BOQ table's column
// labels -- CUSTOM archetype, see below) didn't duplicate this try/catch.
async function resolveRegistryColumns(functionId: string, organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>(`/screen-definitions/${functionId}`, {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error(`[scope/page] screen_definitions resolve failed for ${functionId}, falling back to hardcoded columns:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const compareColumns = await resolveRegistryColumns("boq.compare", organizationId);
  // R46 P8 seq121: boq.custom is a CUSTOM-archetype row -- ScopeClient stays
  // a fully hand-built component (BOQ hierarchy/revisions/weighted sub-tasks
  // are too bespoke for a generic LIST renderer), but the main BOQ table's
  // column LABELS now come from this registry row so they're editable with
  // no redeploy, same as every other converted screen. Nothing about data
  // fetching, row shape, or cell rendering is registry-driven here.
  const boqListColumns = await resolveRegistryColumns("boq.custom", organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Scope of Work (BOQ)" />
        {errorMessage && <ProjectLoadError message={errorMessage} />}
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
            <TabsContent value="boq"><ScopeClient projectId={project.id} compareColumns={compareColumns} listColumns={boqListColumns} /></TabsContent>
            <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]"><CostVarianceAnalyticalClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
