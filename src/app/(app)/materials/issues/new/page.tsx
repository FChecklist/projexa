import { CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MaterialIssueCreateClient from "@/components/MaterialIssueCreateClient";

// R67 D-40: the OUT side of the material ledger. Mirrors
// materials/receipts/new/page.tsx -- a create screen that cannot name its
// project must say so rather than render a form that will 400 on save.
//
// R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03): that mirroring had gone
// stale. This route still carried the bare error Card, while receipts/new had
// already moved to the framed CreateProjectMissing under D-70 -- so the two
// screens disagreed about what a failed project resolution looks like, and this
// one gave the user no breadcrumb, no title and no way back. D1's D-70 sweep
// (CreateScreenUnavailable.test.tsx) caught it as soon as the lanes met. Now
// the mirror is real again.
const FRAME = {
  breadcrumb: "Materials / New Issue",
  title: "New Issue",
  backHref: "/materials",
  backLabel: "Back to Materials",
} as const;

export default async function MaterialIssueNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string; materialId?: string }> }) {
  const { projectId, materialId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);

  if (errorMessage || !project) {
    return (
      <div className="flex-1 p-6">
        <CreateProjectMissing message={errorMessage ?? "No active projects yet."} {...FRAME} />
      </div>
    );
  }

  return (
    <div className="flex-1">
      <MaterialIssueCreateClient projectId={project.id} initialMaterialId={materialId} />
    </div>
  );
}
