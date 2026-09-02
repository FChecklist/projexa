import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import DrawingsClient, { type RegistryColumn } from "@/components/DrawingsClient";

// R46 P8 seq127 (same pattern as permits/page.tsx, R43 seq2): resolved
// server-side so DrawingsClient (a client component) never needs its own
// Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- DrawingsClient falls back to its own hardcoded COLUMNS when this
// is null.
async function resolveDrawingsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/drawings.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[drawings/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, fellBack } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveDrawingsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        {/* R67 D-10: the standalone <PageHeading title="Drawings & 3D" /> that
            used to sit here is gone -- DrawingsClient now renders the standard
            screen frame, whose breadcrumb "Drawings & 3D" sits directly beneath
            it, so the module named itself twice one line apart. Same correction
            D-07 made on /permits, for the same reason. */}
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <DrawingsClient
            projectId={project.id}
            // D-07's rule applied here too: the screen names the project it
            // actually queried, in the empty state and in the fallback notice.
            projectName={project.name}
            fellBack={fellBack}
            registryColumns={registryColumns}
          />
        )}
      </div>
    </>
  );
}
