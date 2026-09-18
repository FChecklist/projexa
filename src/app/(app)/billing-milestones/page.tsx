import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/PageHeading";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import BillingMilestonesClient from "@/components/BillingMilestonesClient";

// Sumeet requirement #3 ("BILLING MILESTONES"): the real create/draft/
// submit/approve/reject/invoice write UI for constructionProgressClaims --
// Project 360 Analysis's tile only ever showed a read-only count. Same
// thin-route convention as every other project-scoped page.tsx here.
export default async function BillingMilestonesPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Billing Milestones" />
        <Card><CardContent className="p-8 text-center text-sm text-px-muted">{errorMessage ?? "No active project selected."}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Billing Milestones" />
      <BillingMilestonesClient projectId={project.id} />
    </div>
  );
}
