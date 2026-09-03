// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the drawings are fetched here on the
// server inside the Suspense boundary and handed to DrawingsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { DRAWINGS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchDrawingsList, getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DrawingsClient, { type Drawing } from "@/components/DrawingsClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={DRAWINGS_LIST_COLUMNS}
    actions={["Floor Plans / 3D Walkthrough", "Add Drawing"]}
  />
);

async function DrawingsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, list, name] = await Promise.all([
    getScreenColumns("drawings.list", organizationId),
    fetchDrawingsList<Drawing>(organizationId, projectId, "drawings"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  // R67 D-65: the project name travels with its id so the pane can name what
  // it is waiting for, and an empty screen can name the project it is empty FOR.
  return <DrawingsClient projectId={projectId} projectName={name} registryColumns={registryColumns} initial={list} />;
}

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Drawings & 3D" />
      <Suspense fallback={SKELETON}>
        <DrawingsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
