import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import PermitsListClient, { type RegistryColumn } from "@/components/PermitsListClient";

// R43 seq2 (M28 registry-model proof): resolved server-side, same place
// organizationId/project already are, so PermitsListClient (a client
// component) never needs its own Bearer-key-authenticated fetch. A missing
// or errored registry row is NOT fatal -- PermitsListClient falls back to
// its own hardcoded COLUMNS when this is null, exactly the "keep the
// hardcoded version behind a flag until verified" instruction from
// platform.r43_queue seq2.
async function resolvePermitsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/permits.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[permits/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; withinDays?: string }> }) {
  const { projectId, withinDays } = await searchParams;
  const organizationId = await getServerOrganizationId();
  // R67 D-07 originally read a `fellBack` boolean added to this resolver. Lane
  // A's A-04/A-05 (merged first) replaced it with the richer `source`, which
  // says WHICH of four rules chose the project -- the URL, the user's own last
  // rail choice, their only project, or the page choosing for them. D-07's
  // question is exactly the last of those, so it is now asked of `source`
  // instead of a second flag meaning the same thing.
  const { project, errorMessage, source } = await resolveSelectedProject(projectId, organizationId);
  const fellBack = source === "auto";
  const registryColumns = await resolvePermitsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        {/* R67 D-07: the standalone <PageHeading title="Permits" /> that used
            to sit here is gone. PermitsListClient's own frame already draws
            the breadcrumb "Permits" directly beneath it, so the module named
            itself twice, one line apart. The frame's breadcrumb is the single
            title band. (Checked across the other module landings before
            removing this one: PermitsListClient and WorkProgressListClient
            are the only two list clients that render a single-segment frame
            breadcrumb at all -- every other module page.tsx's PageHeading is
            that screen's ONLY title, and on /work-progress the frame
            breadcrumb sits inside one pane of a two-pane tab, so removing
            those would leave the screens untitled rather than de-duplicated.) */}
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {/* R42 seq24: DASHBOARD.PROJECT's own "Permits expiring" KPI must land
            here PRE-FILTERED (GLOBAL: filters carried through a KPI click),
            not on the unfiltered list -- withinDays passes straight through
            to the same /api/permits?withinDays= param the KPI count itself
            used, so the two always agree. */}
        {project && (
          <PermitsListClient
            projectId={project.id}
            // R67 D-07: the screen names the project it actually queried,
            // both in the empty state and in the fallback notice.
            projectName={project.name}
            fellBack={fellBack}
            withinDays={withinDays}
            registryColumns={registryColumns}
          />
        )}
      </div>
    </>
  );
}
