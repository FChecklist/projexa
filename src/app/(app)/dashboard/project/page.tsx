import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DashboardProjectClient from "@/components/DashboardProjectClient";

// R42 seq24 (DASHBOARD.PROJECT): distinct from /dashboard (the ORG-level
// home route across every project) -- "the first screen a PM opens every
// morning" for ONE project. Route files stay THIN (GLOBAL) -- all layout
// lives in the kit's DashboardScreen, all wiring in DashboardProjectClient.
export default async function DashboardProjectPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <main className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <DashboardProjectClient projectId={project.id} />
    </main>
  );
}
