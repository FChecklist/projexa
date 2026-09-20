import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ChangeOrdersClient, { type RegistryColumn } from "@/components/ChangeOrdersClient";
import ProjectLoadError from "@/components/ProjectLoadError";

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
  const { project, errorMessage, fellBack } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveVariationsListColumns(organizationId);

  // Owner-reported defect (work order PROJEXA-E2E-001, section 5 item 1):
  // "No change orders yet" showed for a project that genuinely has real
  // change orders, because this page previously named no project at all --
  // resolveSelectedProject()'s documented, deliberate first-project fallback
  // (project-selection.ts) silently picks the org's alphabetically-first
  // project when nothing was asked for, and for at least one real org that
  // project (Business Bay Corporate HQ) has zero seeded change orders while
  // a different project in the same org (Villa 21 - Whitefield) has two --
  // confirmed directly via compliance-tracker's listChangeOrders() service
  // call. The data and the query were never wrong; this screen just never
  // admitted it had guessed. Same fix already shipped for Documents/Labour/
  // Drawings/MoMs (R67 D-13/D-20/D-32) -- naming the resolved project and
  // marking a guess as a guess, via PageHeading's own `project`/`contextNote`
  // slots, so "no change orders on THIS project" and "PROJEXA has no change
  // orders" can no longer be confused for each other.
  const projectNameForHeading = project?.name ?? null;
  const contextNote = fellBack ? "(auto-selected)" : null;

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Change Orders" project={projectNameForHeading} contextNote={contextNote} />
        {errorMessage && <ProjectLoadError message={errorMessage} />}
        {!errorMessage && !project && <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>}
        {project && (
          <ChangeOrdersClient
            projectId={project.id}
            projectName={project.name}
            resolvedByFallback={fellBack}
            registryColumns={registryColumns}
          />
        )}
      </div>
    </>
  );
}
