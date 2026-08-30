import ScheduleTaskCreateClient from "@/components/ScheduleTaskCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { Card, CardContent } from "@/components/ui/card";

// Real-screen conversion (2026-08-30): replaces the old "New Task" Dialog
// popup with a real create route.
export default async function ScheduleTaskNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <ScheduleTaskCreateClient projectId={project.id} />
    </div>
  );
}
