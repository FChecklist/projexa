import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import MaterialsClient, { type RegistryColumn } from "@/components/MaterialsClient";
import MaterialsProjectChooser from "@/components/MaterialsProjectChooser";

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

// R67 D-38: the ONE place this screen can learn the name of a project that is
// no longer in the org's ACTIVE list.
//
// /dashboard (what resolveSelectedProject reads) filters on projects.isActive,
// by design -- see construction-dashboard-service.ts getOrgDashboard. So a
// bookmark or a shared link to a project that has since been closed resolves to
// nothing there, and the screen used to silently show a DIFFERENT project's
// rows under that URL. VERIDIAN's per-project route does NOT filter on
// isActive and 404s for anything outside this org, so:
//   resolves  -> this org's project, not active  -> closed, and we have its name
//   404       -> not this org's project at all   -> fall through to the chooser
export const CLOSED_PROJECT_REASON = "This project is closed — materials are read-only";

async function resolveClosedProjectName(projectId: string, organizationId: string | null): Promise<string | null> {
  try {
    const data = await callVeridian<{ projectId: string; projectName: string }>(`/dashboard/${encodeURIComponent(projectId)}`, {
      organizationId: organizationId ?? undefined,
    });
    return data.projectName ?? null;
  } catch {
    return null;
  }
}

// Point 33: repointed to a real project-scoped material master + receipts
// (was org-wide ERP ledger listing only, no create path) -- same
// resolveSelectedProject pattern as moms/page.tsx.
// R67 D-35: the bare `<PageHeading title="Materials" />` is gone when a
// project resolves -- MaterialsClient owns the header band, because its
// Filter and Export actions operate on the rows the client is holding and
// cannot be driven from a server component.
// R67 D-38: and the screen no longer takes projects[0] when nothing chose a
// project. A project is SELECTED when the URL names one (the URL wins), when
// the rail holds one (resolved by the chooser, which is a client component
// because the rail's selection lives in the browser), or when the org has
// exactly one project and there is nothing to choose between.
export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string; materialId?: string }> }) {
  const { projectId, tab, materialId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { projects, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveMaterialsListColumns(organizationId);

  const requested = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
  const onlyProject = projects.length === 1 ? projects[0] : null;
  const selected = requested ?? onlyProject;

  // A ?projectId= that names nothing in the active list: not a fallback case,
  // and never someone else's rows.
  const closedProjectName =
    projectId && !requested ? await resolveClosedProjectName(projectId, organizationId) : null;

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <>
            <PageHeading title="Materials" />
            <Card className="border-px-error-border bg-px-error-light">
              <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
            </Card>
          </>
        )}

        {!errorMessage && projects.length === 0 && (
          <>
            <PageHeading title="Materials" />
            <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
          </>
        )}

        {!errorMessage && projects.length > 0 && closedProjectName && projectId && (
          <MaterialsClient
            projectId={projectId}
            projectName={closedProjectName}
            registryColumns={registryColumns}
            initialTab={tab}
            initialMaterialId={materialId}
            readOnlyReason={CLOSED_PROJECT_REASON}
          />
        )}

        {!errorMessage && projects.length > 0 && !closedProjectName && selected && (
          <MaterialsClient
            projectId={selected.id}
            projectName={selected.name}
            registryColumns={registryColumns}
            initialTab={tab}
            initialMaterialId={materialId}
          />
        )}

        {!errorMessage && projects.length > 0 && !closedProjectName && !selected && (
          <MaterialsProjectChooser projects={projects} tab={tab} />
        )}
      </div>
    </>
  );
}
