// Real-screen conversion (2026-08-30): replaces the old "Upload Document"
// Dialog popup with a real create route.
//
// R67 MERGE (lane F2's F-19 x lane D1's D-13/D-70/D-78). See
// /drawings/new/page.tsx's header for the full reasoning -- it is the same
// trade, made the same way, on the other upload route.
//
// KEPT FROM F-19: the frame paints at TTFB behind a <Suspense> boundary
// instead of leaving 1.5-1.65 s of blank page.
//
// DECLINED FROM F-19, deliberately: the zero-network fast path. D-78's storage
// probe does not merely add a banner -- it feeds DocumentUploadClient's Save
// `disabledReason`, so rendering the form with the default
// `storageConfigured = true` and correcting it a moment later would make the
// Save button live during exactly the window D-78 exists to close. Lane D0
// declined the same optimisation on /moms/new; this follows that precedent.
//
// KEPT FROM D-70 (audit R-262): the failure branch is no longer a bare Card
// carrying resolveSelectedProject's raw message -- an upstream 500 with no JSON
// body degrades into the words "Internal Server Error", and that used to
// replace the whole right pane with no title, no Back and no Retry.
// CreateProjectMissing now renders the module's own frame around it.
import { Suspense } from "react";
import DocumentUploadClient from "@/components/DocumentUploadClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getStorageStatus } from "@/lib/storage-status";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

const FRAME = {
  breadcrumb: "Documents / New Document",
  title: "New Document",
  backHref: "/documents",
  backLabel: "Back to Documents",
} as const;

async function ResolvedForm({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // R67 D-78: both reads at once -- the storage probe is answered from
  // VERIDIAN's own 60 s cache, so it costs nothing and lets the screen say that
  // no upload can succeed BEFORE the user drops a 30 MB file on the zone.
  const [{ project, errorMessage }, storageConfigured] = await Promise.all([
    resolveSelectedProject(requestedProjectId, organizationId),
    getStorageStatus(organizationId),
  ]);

  if (errorMessage || !project) return <CreateProjectMissing message={errorMessage} {...FRAME} />;

  // R67 D-13: the project NAME goes through too, so the create screen can show
  // "Project: <name>" as a facet -- where the file will land, stated before the
  // file is chosen rather than after it is filed.
  return <DocumentUploadClient projectId={project.id} projectName={project.name} storageConfigured={storageConfigured} />;
}

export default async function DocumentsUploadPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1">
      <Suspense
        fallback={
          <div className="p-6">
            <CreateFormSkeleton fields={4} />
          </div>
        }
      >
        <ResolvedForm requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
