// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the unfiltered document list -- what the
// screen's default "All categories" shows -- is fetched here on the server
// inside the Suspense boundary and handed to DocumentsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { ProjectRequiredCard } from "@/components/ProjectRequiredCard";
import { DOCUMENTS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchDocumentsList, getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DocumentsClient, { type Doc } from "@/components/DocumentsClient";

const SKELETON = <ModuleListSkeletonBody columns={DOCUMENTS_LIST_COLUMNS} actions={["Upload"]} />;

async function DocumentsSection({ requestedProjectId }: { requestedProjectId?: string }) {
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
  if (!projectId && mode === "all") return <ProjectRequiredCard module="Documents" />;
  if (!projectId) return <ModuleProjectNotice errorMessage={null} />;

  const [registryColumns, list, name] = await Promise.all([
    getScreenColumns("documents.list", organizationId),
    fetchDocumentsList<Doc>(organizationId, projectId, "documents"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  // R67 D-65: the name travels with the id so the waiting caption and the
  // empty sentence can both name the project the user chose.
  return <DocumentsClient projectId={projectId} projectName={name} registryColumns={registryColumns} initial={list} />;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Documents" />
      <Suspense fallback={SKELETON}>
        <DocumentsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
