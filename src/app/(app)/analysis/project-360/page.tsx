import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import Project360Client from "@/components/Project360Client";

// Sumeet requirement #7: "for a project, the change of BOQ, change of
// scope, billing, milestones, timelines analysis" -- one combined view.
// Same thin-route/all-wiring-in-the-client convention as
// dashboard/project/page.tsx, the closest sibling (one project, several
// already-built domains combined on one screen).
export default async function Project360Page({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Project 360 Analysis" />
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Project 360 Analysis" />
      <Project360Client projectId={project.id} projectName={project.name} />
    </div>
  );
}
