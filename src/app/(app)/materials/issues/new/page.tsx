import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MaterialIssueCreateClient from "@/components/MaterialIssueCreateClient";

// R67 D-40: the OUT side of the material ledger. Mirrors
// materials/receipts/new/page.tsx exactly, including its honest failure card --
// a create screen that cannot name its project must say so rather than render
// a form that will 400 on save.
export default async function MaterialIssueNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string; materialId?: string }> }) {
  const { projectId, materialId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

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
      <MaterialIssueCreateClient projectId={project.id} initialMaterialId={materialId} />
    </div>
  );
}
