import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ScopeClient, { type RegistryColumn } from "@/components/ScopeClient";
import CostVarianceAnalyticalClient from "@/components/CostVarianceAnalyticalClient";

// R44 seq3 (M28 registry-model proof, same pattern as permits/page.tsx's
// resolvePermitsListColumns): resolved server-side so ScopeClient's compare
// dialog never needs its own Bearer-key-authenticated fetch. A missing or
// errored registry row is NOT fatal -- ScopeClient falls back to its own
// hardcoded compare columns when this is null.
async function resolveBoqCompareColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/boq.compare", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[scope/page] screen_definitions resolve failed, falling back to hardcoded compare columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const compareColumns = await resolveBoqCompareColumns(organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Scope of Work (BOQ)" />
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
            <TabsContent value="boq"><ScopeClient projectId={project.id} compareColumns={compareColumns} /></TabsContent>
            <TabsContent value="variance" className="h-[calc(100vh-14rem)] min-h-[560px]"><CostVarianceAnalyticalClient projectId={project.id} /></TabsContent>
          </Tabs>
        )}
      </main>
    </>
  );
}
