import ScheduleTaskCreateClient from "@/components/ScheduleTaskCreateClient";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveIssueTypes } from "@/lib/schedule-reference";
import { Card, CardContent } from "@/components/ui/card";

// Real-screen conversion (2026-08-30): replaces the old "New Task" Dialog
// popup with a real create route.
//
// R67 F-09 (R-122), D-04: the task-type list is resolved HERE, in parallel
// with the project, and handed to the form as a prop. It used to be fetched
// from the browser after hydration, so the Type select -- the one field on
// this form that cannot be typed -- rendered empty with "Loading…" in it and
// filled in a round trip later.
export default async function ScheduleTaskNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const [{ project, errorMessage }, types] = await Promise.all([
    resolveSelectedProject(projectId, organizationId, { cacheSeconds: 60 }),
    resolveIssueTypes(organizationId),
  ]);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <ScheduleTaskCreateClient projectId={project.id} types={types} />
    </div>
  );
}
