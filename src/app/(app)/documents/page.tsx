import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
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

// R67 D-13: the project was already resolved here and everything but its id was
// thrown away, which is why the screen below it could never name the project it
// had queried. `fellBack` (added for D-07) says whether the caller asked for
// this project or got the org's first one by default -- the title band prefixes
// "Showing" in that case, because "Documents · Cedar Heights" and "Documents ·
// Showing Cedar Heights" are different claims.
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage, fellBack } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveDocumentsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading
          title="Documents"
          subtitle={project ? `· ${fellBack ? "Showing " : ""}${project.name}` : undefined}
        />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <DocumentsClient
            projectId={project.id}
            projectName={project.name}
            fellBack={fellBack}
            projects={projects}
            registryColumns={registryColumns}
          />
        )}
      </div>
    </>
  );
}
