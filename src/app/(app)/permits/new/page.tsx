// R42 seq21: PERMITS.OBJECT create mode. Deliberate scope note (evidence,
// not silent deviation): creation goes through the EXISTING multipart
// POST /api/permits (Wave 143, already real+working -- a required PDF
// upload doesn't fit the generic JSON screen_drafts payload M29 defines),
// not the new draft-lifecycle machinery. The new OBJECT-screen draft
// lifecycle (Edit -> autosave -> leave/return -> reload -> Save) that seq21
// actually introduces is proven on the EDIT path in permits/[id] instead.
//
// R67 MERGE (lane F2's F-19 x lane D1's D-06/D-70/D-78). Same trade as
// /drawings/new and /documents/upload -- see /drawings/new/page.tsx's header
// for the full reasoning. F-19's <Suspense> frame is kept so the screen paints
// at TTFB; F-19's zero-network fast path is declined on this route alone with
// the other two upload routes, because D-78's storage probe feeds
// PermitCreateClient's Save `disabledReason` and a form that is briefly live
// before the probe lands is the fail-after-click D-78 exists to remove.
import { Suspense } from "react";
import PermitCreateClient from "@/components/PermitCreateClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getStorageStatus } from "@/lib/storage-status";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

const FRAME = {
  breadcrumb: "Permits / New Permit",
  title: "New Permit",
  backHref: "/permits",
  backLabel: "Back to Permits",
} as const;

async function ResolvedForm({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // R67 D-78: both reads at once -- the storage probe is answered from
  // VERIDIAN's own 60 s cache, so it costs nothing and lets the screen say that
  // no upload can succeed BEFORE the user picks a file.
  const [{ project, errorMessage }, storageConfigured] = await Promise.all([
    resolveSelectedProject(requestedProjectId, organizationId),
    getStorageStatus(organizationId),
  ]);

  // R67 D-70 (audit R-262): the failure is reported inside the screen's own
  // frame, with a Retry and a way back -- never as a bare Card holding the raw
  // upstream message.
  if (errorMessage || !project) return <CreateProjectMissing message={errorMessage} {...FRAME} />;

  return (
    // R67 D-06: the name goes down with the id so the screen can state
    // "For project: <name>" under its title -- a create screen must say where
    // the record it is about to write will land.
    <PermitCreateClient projectId={project.id} projectName={project.name} storageConfigured={storageConfigured} />
  );
}

export default async function NewPermitPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 p-6">
      <Suspense fallback={<CreateFormSkeleton fields={5} />}>
        <ResolvedForm requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
