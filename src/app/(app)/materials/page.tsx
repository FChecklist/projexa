// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the material master -- the tab this
// screen opens on -- is fetched here on the server inside the Suspense
// boundary and handed to MaterialsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { MATERIAL_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchMaterialMasterList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MaterialsClient, { type Material } from "@/components/MaterialsClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={MATERIAL_LIST_COLUMNS}
    tabs={["Material Master", "Inbound Receipts", "Cost Report"]}
    actions={["Add Material"]}
  />
);

async function MaterialsSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, master] = await Promise.all([
    getScreenColumns("material.list", organizationId),
    fetchMaterialMasterList<Material>(organizationId, projectId, "the material master"),
  ]);

  return (
    <MaterialsClient
      projectId={projectId}
      registryColumns={registryColumns}
      initialTab={tab}
      initialMaster={master}
    />
  );
}

// Point 33: repointed to a real project-scoped material master + receipts
// (was org-wide ERP ledger listing only, no create path).
export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Materials" />
      <Suspense fallback={SKELETON}>
        <MaterialsSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
