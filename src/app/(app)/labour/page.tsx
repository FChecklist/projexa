import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import LabourClient, { type RegistryColumn, type RosterFilterState } from "@/components/LabourClient";

// R46 P8 seq132 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns in permits/page.tsx, R46 P8 seq128's
// resolveDocumentsListColumns in documents/page.tsx, and R46 P8 seq134's
// resolveVariationsListColumns in change-orders/page.tsx): resolved
// server-side, same place organizationId/project already are, so
// LabourClient (a client component) never needs its own
// Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- LabourClient falls back to its own hardcoded COLUMNS when this
// is null.
async function resolveLabourListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/manpower.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[labour/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 D-32: the page no longer renders the heading when a project resolves --
// LabourClient owns the header band, because the header's Filter and Export
// actions operate on the rows the client is holding and cannot be driven from
// a server component. The page keeps a plain heading for the two states where
// there are no rows at all (a projects lookup failure, or an org with no
// projects), so the screen is never headless.
//
// resolvedByFallback is passed straight through: it is the difference between
// "the user picked this project" and "this is simply the org's first project",
// and the screen has to say which.
// R67 D-53: `date` belongs to the Daily Summary tab and is read here so the
// first paint already knows which day it is showing. A malformed value is
// ignored rather than forwarded -- the client then falls back to today, which
// beats fetching a report for "2026-13-45".
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function LabourPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string; q?: string; trade?: string; company?: string; status?: string; date?: string }> }) {
  const { projectId, tab, q, trade, company, status, date } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, resolvedByFallback } = await resolveSelectedProject(projectId, organizationId);
  const registryColumns = await resolveLabourListColumns(organizationId);

  const initialFilter: Partial<RosterFilterState> = {
    ...(q ? { q } : {}),
    ...(trade ? { trade } : {}),
    ...(company ? { company } : {}),
    ...(status === "active" || status === "inactive" || status === "all" ? { status } : {}),
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {!project && <PageHeading title="Manpower & Attendance" />}
      {errorMessage && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
        </Card>
      )}
      {!errorMessage && !project && (
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
      )}
      {project && (
        <LabourClient
          projectId={project.id}
          projectName={project.name}
          resolvedByFallback={resolvedByFallback}
          registryColumns={registryColumns}
          initialTab={tab}
          initialFilter={initialFilter}
          initialSummaryDate={date && ISO_DATE.test(date) ? date : undefined}
        />
      )}
    </div>
  );
}
