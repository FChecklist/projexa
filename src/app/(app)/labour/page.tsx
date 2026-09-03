import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import ScreenLoading from "@/components/ScreenLoading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";
import LabourClient, { type RegistryColumn } from "@/components/LabourClient";

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
      timeoutMs: VERIDIAN_SCREEN_BUDGET_MS,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[labour/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 D-04 -- Option A, applied to one of the two pages the R66 audit actually
// MEASURED as slow (/labour ~6 s). Two changes, both structural:
//
//   1. The two VERIDIAN hops were SERIAL -- resolveSelectedProject() awaited,
//      then /screen-definitions/manpower.list awaited -- even though neither
//      depends on the other. They now run concurrently.
//   2. The reads moved into a child async component behind <Suspense>, so the
//      heading streams immediately and the wait shows a skeleton in the shape
//      of the real table with the "Still loading..." caption at 3 s, instead of
//      a blank frame for the whole round trip.
//
// The API key stays server-side throughout, which is the half of decision D-04
// that rules out Option B.
async function LabourBody({ projectId, tab }: { projectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, registryColumns] = await Promise.all([
    resolveSelectedProject(projectId, organizationId),
    resolveLabourListColumns(organizationId), // never rejects -- see its own catch
  ]);

  return (
    <>
      {errorMessage && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
        </Card>
      )}
      {!errorMessage && !project && (
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
      )}
      {project && <LabourClient projectId={project.id} registryColumns={registryColumns} initialTab={tab} />}
    </>
  );
}

export default async function LabourPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Manpower & Attendance" />
        <Suspense fallback={<ScreenLoading entity="the manpower roster" rows={5} columns={5} />}>
          <LabourBody projectId={projectId} tab={tab} />
        </Suspense>
      </div>
    </>
  );
}
