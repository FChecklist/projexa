import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { defaultMomsRange, parseMomsFilter, type MomsFilter } from "@/lib/moms-list";
import MoMsClient, { type RegistryColumn } from "@/components/MoMsClient";

// R46 P8 seq129 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns in permits/page.tsx, R46 P8 seq134's
// resolveVariationsListColumns in change-orders/page.tsx, and R46 P8
// seq128's resolveDocumentsListColumns in documents/page.tsx): resolved
// server-side, same place organizationId/project already are, so
// MoMsClient (a client component) never needs its own
// Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- MoMsClient falls back to its own hardcoded COLUMNS when this is
// null.
async function resolveMoMsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/moms.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[moms/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 D-20. This screen is the first to OPT IN to the honest all-projects
// mode: with no ?projectId= in the URL it no longer resolves to the org's
// first project behind the user's back. That mattered here more than
// anywhere else -- minutes typed under a silently-chosen project can be
// Published, which locks them server-side (assertEditable), so the wrong
// answer is not just wrong, it is irreversible.
//
// R67 D-16. `from`/`to`/`status`/`attendee` are read HERE, on the server,
// rather than in the client, for two reasons: "the last 90 days" needs a
// notion of today and computing it during a client render would produce a
// different string from the server's pass (a hydration mismatch, exactly the
// class format-date.ts exists to prevent), and reading them here is what
// makes the browser's own Back button restore the filter.
export default async function MoMsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; status?: string; from?: string; to?: string; attendee?: string }>;
}) {
  const params = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, projects, errorMessage, mode, fellBack } = await resolveSelectedProject(
    params.projectId,
    organizationId,
    { allProjectsWhenUnset: true }
  );
  const registryColumns = await resolveMoMsListColumns(organizationId);

  const today = new Date();
  const range = defaultMomsRange(today);
  const defaultFilter: MomsFilter = { status: "", attendee: "", ...range };
  const initialFilter = parseMomsFilter(
    new URLSearchParams(
      Object.entries(params)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([k, v]) => [k, v])
    ),
    today
  );

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading
          title="Minutes of Meeting"
          context={project ? project.name : mode === "all" ? "All projects" : null}
          contextNote={fellBack ? "(auto-selected)" : null}
        />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && (
          <MoMsClient
            projectId={project?.id ?? null}
            projectName={project?.name ?? null}
            mode={mode}
            fellBack={fellBack}
            projects={projects}
            initialFilter={initialFilter}
            defaultFilter={defaultFilter}
            registryColumns={registryColumns}
          />
        )}
      </div>
    </>
  );
}
