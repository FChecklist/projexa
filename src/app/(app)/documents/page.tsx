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

// R67 D-13 (lane D1, folded into lane F2's streamed structure). The project was
// already resolved on this route and everything but its id was thrown away,
// which is why the screen below could never name the project it had queried.
// The heading now carries it -- and says so when the project was chosen FOR the
// user rather than by them, because "Documents - Cedar Heights" and "Documents -
// Cedar Heights (auto-selected)" are different claims.
//
// The heading is rendered in BOTH the Suspense fallback and here, with the same
// text at the same position, so F-18's "the frame paints at TTFB" still holds:
// the title is on screen immediately and only gains its scope when the project
// is known. No layout jump, and no second heading.
const HEADING_TITLE = "Documents";

async function DocumentsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, mode, source } = await resolveProjectForModule(
    requestedProjectId,
    organizationId,
    // R67 D-20 + D-66: this module is per-project, so it OPTS IN to the honest
    // mode. Without the flag, arriving with no ?projectId= silently resolved
    // the org's FIRST project and rendered its rows under a rail reading "All
    // projects" -- and a write made on that screen went to a project nobody
    // chose.
    { allProjectsWhenUnset: true }
  );
  if (errorMessage) {
    return (
      <>
        <PageHeading title={HEADING_TITLE} />
        <ModuleProjectNotice errorMessage={errorMessage} />
      </>
    );
  }
  // Two different answers, told apart at last: "you are looking at the whole
  // org and this module needs one project" is not the same as "this org has no
  // projects".
  if (!projectId && mode === "all") {
    return (
      <>
        <PageHeading title={HEADING_TITLE} />
        <ProjectRequiredCard module="Documents" />
      </>
    );
  }
  if (!projectId) {
    return (
      <>
        <PageHeading title={HEADING_TITLE} />
        <ModuleProjectNotice errorMessage={null} />
      </>
    );
  }

  const [registryColumns, list, name] = await Promise.all([
    getScreenColumns("documents.list", organizationId),
    fetchDocumentsList<Doc>(organizationId, projectId, "documents"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  // R67 D-65: the name travels with the id so the waiting caption and the
  // empty sentence can both name the project the user chose.
  return (
    <>
      {/* R67 D-13: the title band names the project this screen queried. */}
      <PageHeading
        title={HEADING_TITLE}
        context={name}
        contextNote={source === "auto" ? "auto-selected" : null}
      />
      <DocumentsClient projectId={projectId} projectName={name} registryColumns={registryColumns} initial={list} />
    </>
  );
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <Suspense
        fallback={
          <>
            <PageHeading title={HEADING_TITLE} />
            {SKELETON}
          </>
        }
      >
        <DocumentsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
