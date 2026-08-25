import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ChangeOrdersClient, { type RegistryColumn } from "@/components/ChangeOrdersClient";

// R46 P8 seq134 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns in permits/page.tsx): resolved server-side, same
// place organizationId/project already are, so ChangeOrdersClient (a client
// component) never needs its own Bearer-key-authenticated fetch. A missing
// or errored registry row is NOT fatal -- ChangeOrdersClient falls back to
// its own hardcoded COLUMNS when this is null.
async function resolveVariationsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/variations.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[change-orders/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function ChangeOrdersPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveVariationsListColumns(organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Change Orders" />
        {errorMessage && <Card className="border-px-error-border bg-px-error-light"><CardContent className="p-4 text-sm text-px-error">{errorMessage}</CardContent></Card>}
        {!errorMessage && !project && <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>}
        {project && <ChangeOrdersClient projectId={project.id} registryColumns={registryColumns} />}
      </main>
    </>
  );
}
