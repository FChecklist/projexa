import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MoMCreateClient from "@/components/MoMCreateClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";

export default async function MoMNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, source } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">{errorMessage ?? "No active projects yet."}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1">
      {/* R67 A-03: the create screen is inside one project too -- the shell's
          rail and strip must say which, not "All projects". */}
      <ScreenContext moduleId="moms" project={project} source={source ?? "auto"} />
      {/* R67 lane D22 (item D-63): the project's name is what makes the
          default title specific ("Skyline Tower A - site coordination"). */}
      <MoMCreateClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
