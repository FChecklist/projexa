import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import MaterialsClient, { type RegistryColumn } from "@/components/MaterialsClient";

// R46 P8 seq131 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns in permits/page.tsx and R46 P8 seq128/seq134's
// documents.list/variations.list resolvers): resolved server-side, same
// place organizationId/project already are, so MaterialsClient (a client
// component) never needs its own Bearer-key-authenticated fetch. Only the
// Material Master table (name/spec/unit/unitCost) is registry-driven --
// Inbound Receipts has no registry equivalent and stays exactly as-is,
// same "one table only" contract Documents/ChangeOrders used for their own
// non-registry pieces (category filter / Actions column). A missing or
// errored registry row is NOT fatal -- MaterialsClient falls back to its
// own hardcoded COLUMNS when this is null.
async function resolveMaterialsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/material.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[materials/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Point 33: repointed to a real project-scoped material master + receipts
// (was org-wide ERP ledger listing only, no create path) -- same
// resolveSelectedProject pattern as moms/page.tsx.
export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveMaterialsListColumns(organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Materials" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && <MaterialsClient projectId={project.id} registryColumns={registryColumns} />}
      </main>
    </>
  );
}
