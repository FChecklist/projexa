// R67 MERGE (lane F2's F-19 x lane D1's D-08/D-78).
//
// F-19 (audit R-245) measured this create route at 1.5-1.65 s to first byte,
// for a form of three to seven fields, because it awaited
// getServerOrganizationId() and then a VERIDIAN call before emitting a byte.
// Its fix had two halves: paint the frame at TTFB behind a <Suspense>
// boundary, and skip the network entirely when ?projectId= or the rail's
// cookie already knows which project this is.
//
// THE FIRST HALF IS KEPT IN FULL. The second is declined HERE, and only here
// and on the other two upload routes, for a reason F-19 had no way to know
// about: D-78 makes the server say whether an upload could EVER succeed
// (getStorageStatus), and that answer does not merely add a banner -- it feeds
// DrawingCreateClient's Save `disabledReason`. Rendering the form with the
// default `storageConfigured = true` and correcting it later would mean the
// Save button is live for the moment before the probe lands, which is exactly
// the fail-after-click D-78 exists to remove. Lane D0 declined the same
// optimisation on /moms/new for the same shape of reason, so this is the
// established precedent rather than a new one. The probe is answered from
// VERIDIAN's own 60 s cache and runs concurrently with the project read, so
// what a user waits for is one round trip behind a painted skeleton, not a
// blank page.
//
// D-08 (audit R-032) also stands: this route NEVER returns early. It used to
// return a bare Card carrying resolveSelectedProject's raw errorMessage, so
// the whole right pane became the words "Internal Server Error" -- no title,
// no Back, no Retry. Correction C-06 records that the CAUSE of that failure
// was never established, so the fix cannot be conditional on the cause. The
// screen renders in every case and the failure is reported inside it, which is
// why there is no CreateProjectMissing branch below.
//
// projectId comes from the search param FIRST (DrawingsClient always pushes
// ?projectId= when it opens this route), so a failed project-list resolution
// no longer costs the user the project they had already chosen -- the id is
// right there in the URL and the create call only needs the id. The name is
// resolved in the background by the client, and VERIDIAN scopes the id to the
// org on the write, so an id that is not this org's is refused there.
import { Suspense } from "react";
import DrawingCreateClient from "@/components/DrawingCreateClient";
import { CreateFormSkeleton } from "@/components/CreateFormSkeleton";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getStorageStatus } from "@/lib/storage-status";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

async function ResolvedForm({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // R67 D-78: both reads at once. The storage probe is answered from VERIDIAN's
  // own 60 s cache, so this adds no measurable time to the page, and it is the
  // difference between a user learning that no upload can succeed BEFORE they
  // pick a 40 MB file and learning it afterwards.
  const [{ project, errorMessage }, storageConfigured] = await Promise.all([
    resolveSelectedProject(requestedProjectId, organizationId),
    getStorageStatus(organizationId),
  ]);

  return (
    <DrawingCreateClient
      projectId={requestedProjectId ?? project?.id ?? null}
      projectName={project?.name}
      projectError={errorMessage}
      storageConfigured={storageConfigured}
    />
  );
}

export default async function DrawingsNewPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1">
      <Suspense
        fallback={
          <div className="p-6">
            <CreateFormSkeleton fields={5} />
          </div>
        }
      >
        <ResolvedForm requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
