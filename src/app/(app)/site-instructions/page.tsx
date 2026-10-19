// R-C14: the list of site instructions for one project. The project comes from ?projectId= or the project cookie, resolved
// server-side with no extra round trip when either is present; the rows are read by the client from /api/site-instructions.
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { SiteInstructionsList } from "@/components/SiteInstructionViews";
import { getProjectName, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

export default async function SiteInstructionsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId: requested } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName, errorMessage } = await resolveProjectForModule(requested, organizationId);
  return (
    <div className="flex-1 space-y-6 p-6">
      {projectId ? (
        <SiteInstructionsList projectId={projectId} projectName={projectName ?? (await getProjectName(projectId, organizationId))} />
      ) : (
        <ModuleProjectNotice errorMessage={errorMessage} />
      )}
    </div>
  );
}
