// R-C14: the create route. Same trade as /permits/new: a <Suspense> frame so the screen paints at once, the project resolved on
// the server so the form can say where the instruction will land.
import { Suspense } from "react";
import SiteInstructionCreateClient from "@/components/SiteInstructionCreateClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

const FRAME = {
  breadcrumb: "Site Instructions / New Site Instruction",
  title: "New Site Instruction",
  backHref: "/site-instructions",
  backLabel: "Back to Site Instructions",
} as const;

async function ResolvedForm({ requestedProjectId, boqId }: { requestedProjectId?: string; boqId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(requestedProjectId, organizationId);
  if (errorMessage || !project) return <CreateProjectMissing message={errorMessage} {...FRAME} />;
  return <SiteInstructionCreateClient projectId={project.id} projectName={project.name} boqId={boqId} />;
}

export default async function NewSiteInstructionPage({ searchParams }: { searchParams: Promise<{ projectId?: string; boqId?: string }> }) {
  const { projectId, boqId } = await searchParams;
  return (
    <div className="flex-1 p-6">
      <Suspense fallback={<CreateFormSkeleton fields={5} />}>
        <ResolvedForm requestedProjectId={projectId} boqId={boqId} />
      </Suspense>
    </div>
  );
}
