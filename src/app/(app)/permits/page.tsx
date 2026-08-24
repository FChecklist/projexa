import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import PermitsListClient from "@/components/PermitsListClient";

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; withinDays?: string }> }) {
  const { projectId, withinDays } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Permits" />
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
        {project && <PermitsListClient projectId={project.id} withinDays={withinDays} />}
      </main>
    </>
  );
}
