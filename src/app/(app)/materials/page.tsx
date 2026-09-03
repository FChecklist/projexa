// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the material master -- the tab this
// screen opens on -- is fetched here on the server inside the Suspense
// boundary and handed to MaterialsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { ProjectRequiredCard } from "@/components/ProjectRequiredCard";
import { MATERIAL_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchMaterialMasterList, getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import MaterialsClient, { type Material } from "@/components/MaterialsClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={MATERIAL_LIST_COLUMNS}
    tabs={["Material Master", "Inbound Receipts", "Cost Report"]}
    actions={["Add Material"]}
  />
);

// R67 D-38: the ONE place this screen can learn the name of a project that is
// no longer in the org's ACTIVE list.
//
// The project resolution reads /dashboard, which filters on projects.isActive
// by design. So a bookmark or a shared link to a project that has since been
// closed resolves to nothing there, and the screen used to silently show a
// DIFFERENT project's rows under that URL. VERIDIAN's per-project route does
// NOT filter on isActive and 404s for anything outside this org, so:
//   resolves -> this org's project, not active -> closed, and we have its name
//   404      -> not this org's project at all  -> fall through to the chooser
// NOT exported. A page.tsx may only export the default component and Next's
// own known route fields; an arbitrary named export makes `next build` fail
// the generated route-type check, and tsc --noEmit does not catch it. This
// constant has exactly one reader, forty lines below.
const CLOSED_PROJECT_REASON = "This project is closed — materials are read-only";

async function resolveClosedProjectName(projectId: string, organizationId: string | null): Promise<string | null> {
  try {
    const data = await callVeridian<{ projectId: string; projectName: string }>(
      `/dashboard/${encodeURIComponent(projectId)}`,
      { organizationId: organizationId ?? undefined }
    );
    return data.projectName ?? null;
  } catch {
    return null;
  }
}

async function MaterialsSection({
  requestedProjectId,
  tab,
  materialId,
}: {
  requestedProjectId?: string;
  tab?: string;
  /** From ?materialId= -- set when the Cost Report drills into one material's receipts. */
  materialId?: string;
}) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, mode } = await resolveProjectForModule(
    requestedProjectId,
    organizationId,
    // R67 D-20 + D-66: this module is per-project, so it OPTS IN to the honest
    // mode. Without the flag, arriving with no ?projectId= silently resolved
    // the org's FIRST project and rendered its rows under a rail reading "All
    // projects" -- and a write made on that screen went to a project nobody
    // chose.
    { allProjectsWhenUnset: true }
  );
  if (errorMessage) return <ModuleProjectNotice errorMessage={errorMessage} />;
  // Two different answers, told apart at last: "you are looking at the whole
  // org and this module needs one project" is not the same as "this org has no
  // projects".
  if (!projectId) {
    // R67 D-38: a ?projectId= that names nothing ACTIVE is worth one question
    // before the chooser -- is it closed, or is it not ours at all? A closed
    // project is rendered read-only under its OWN name rather than swapped for
    // a different project's rows.
    const closedName = requestedProjectId ? await resolveClosedProjectName(requestedProjectId, organizationId) : null;
    if (closedName) {
      const [registryColumns, master] = await Promise.all([
        getScreenColumns("material.list", organizationId),
        fetchMaterialMasterList<Material>(organizationId, requestedProjectId!, "the material master"),
      ]);
      return (
        <MaterialsClient
          projectId={requestedProjectId!}
          projectName={closedName}
          registryColumns={registryColumns}
          initialTab={tab}
          initialMaterialId={materialId}
          initialMaster={master}
          readOnlyReason={CLOSED_PROJECT_REASON}
        />
      );
    }
    if (mode === "all") return <ProjectRequiredCard module="Materials" />;
    return <ModuleProjectNotice errorMessage={null} />;
  }

  const [registryColumns, master, name] = await Promise.all([
    getScreenColumns("material.list", organizationId),
    fetchMaterialMasterList<Material>(organizationId, projectId, "the material master"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  return (
    <MaterialsClient
      projectId={projectId}
      // R67 D-65: the name travels with the id so the waiting caption and the
      // empty sentence can both name the project the user chose.
      projectName={name}
      registryColumns={registryColumns}
      initialTab={tab}
      initialMaterialId={materialId}
      initialMaster={master}
    />
  );
}

// Point 33: repointed to a real project-scoped material master + receipts
// (was org-wide ERP ledger listing only, no create path).
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; materialId?: string }>;
}) {
  const { projectId, tab, materialId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Materials" />
      <Suspense fallback={SKELETON}>
        <MaterialsSection requestedProjectId={projectId} tab={tab} materialId={materialId} />
      </Suspense>
    </div>
  );
}
