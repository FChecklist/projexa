import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { ProjectRequiredCard } from "@/components/ProjectRequiredCard";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import DocumentsClient, { type RegistryColumn } from "@/components/DocumentsClient";

// R46 P8 seq128 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns in permits/page.tsx and R46 P8 seq134's
// resolveVariationsListColumns in change-orders/page.tsx): resolved
// server-side, same place organizationId/project already are, so
// DocumentsClient (a client component) never needs its own
// Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- DocumentsClient falls back to its own hardcoded COLUMNS when
// this is null.
async function resolveDocumentsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/documents.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[documents/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  // R67 D-20 + D-66: this module is per-project, so it OPTS IN to the
  // honest mode. Without the flag, arriving with no ?projectId= silently
  // resolved the org's FIRST project and rendered its rows under a rail
  // reading "All projects" -- and a write made on that screen went to a
  // project nobody chose.
  const { project, errorMessage, mode } = await resolveSelectedProject(projectId, organizationId, {
    allProjectsWhenUnset: true,
  });
  const registryColumns = await resolveDocumentsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Documents" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {/* Two different answers, told apart at last: "you are looking at
            the whole org and this module needs one project" is not the
            same as "this org has no projects". */}
        {!errorMessage && !project && mode === "all" && <ProjectRequiredCard module="Documents" />}
        {!errorMessage && !project && mode !== "all" && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {/* R67 D-65: the name travels with the id so the waiting caption and
            the empty sentence can both name the project the user chose. */}
        {project && <DocumentsClient projectId={project.id} projectName={project.name} registryColumns={registryColumns} />}
      </div>
    </>
  );
}
