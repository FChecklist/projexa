import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import DashboardProjectClient, { type RegistryColumn } from "@/components/DashboardProjectClient";

// R42 seq24 (DASHBOARD.PROJECT): distinct from /dashboard (the ORG-level
// home route across every project) -- "the first screen a PM opens every
// morning" for ONE project. Route files stay THIN (GLOBAL) -- all layout
// lives in the kit's DashboardScreen, all wiring in DashboardProjectClient.
//
// R46 P8 seq125 (M28 registry-model, DASHBOARD archetype, function_id
// "dashboard.dashboard" -- first DASHBOARD conversion this session): same
// try/catch/404-is-not-an-error contract as resolvePermitsListColumns /
// resolveRegistryColumns (permits/page.tsx, scope/page.tsx). A missing or
// errored row is NOT fatal -- DashboardProjectClient falls back to its own
// hardcoded DEFAULT_LABELS when this is null.
async function resolveDashboardLabels(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/dashboard.dashboard", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[dashboard/project/page] screen_definitions resolve failed, falling back to hardcoded labels:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function DashboardProjectPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const labels = await resolveDashboardLabels(organizationId);

  if (errorMessage || !project) {
    return (
      <main className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <DashboardProjectClient projectId={project.id} labels={labels} />
    </main>
  );
}
