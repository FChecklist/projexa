import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { ProjectRequiredCard } from "@/components/ProjectRequiredCard";
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
export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  // R67 D-20 + D-66: this module is per-project, so it OPTS IN to the
  // honest mode. Without the flag, arriving with no ?projectId= silently
  // resolved the org's FIRST project and rendered its rows under a rail
  // reading "All projects" -- and a write made on that screen went to a
  // project nobody chose.
  const { project, errorMessage, mode } = await resolveSelectedProject(projectId, organizationId, {
    allProjectsWhenUnset: true,
  });
  const registryColumns = await resolveMaterialsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Materials" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {/* Two different answers, told apart at last: "you are looking at
            the whole org and this module needs one project" is not the
            same as "this org has no projects". */}
        {!errorMessage && !project && mode === "all" && <ProjectRequiredCard module="Materials" />}
        {!errorMessage && !project && mode !== "all" && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {/* R67 D-65: the name goes with the id so each of the three panes can
            say what it is waiting for, and for which project. */}
        {project && <MaterialsClient projectId={project.id} projectName={project.name} registryColumns={registryColumns} initialTab={tab} />}
      </div>
    </>
  );
}
