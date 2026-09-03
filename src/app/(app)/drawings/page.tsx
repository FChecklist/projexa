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
    // R67 D-10 (lane D1, folded in at the merge). These were the two buttons
    // D-10 REMOVED -- "Floor Plans / 3D Walkthrough" and "Add Drawing" -- so
    // the skeleton was drawing controls the loaded screen no longer has, and
    // the header visibly changed shape under the user when the rows landed.
    // Same three, same order, as the frame beneath it.
    actions={["Filter", "Export", "New"]}
  />
);

// R67 D-10 (lane D1, folded into lane F2's streamed structure). The module used
// to name itself TWICE, one line apart -- this PageHeading and DrawingsClient's
// own screen-frame breadcrumb beneath it. Same correction D-07 made on /permits,
// resolved the same way: the heading stays (F-18/F-31 make it the thing that
// paints at TTFB, and the skeleton would otherwise be untitled) and the frame's
// band names the PROJECT this screen queried instead of repeating the module.
const HEADING_TITLE = "Drawings & 3D";

async function DrawingsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, source } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return (
    <>
      <PageHeading title={HEADING_TITLE} />
      <ModuleProjectNotice errorMessage={errorMessage} />
    </>
  );

  const [registryColumns, list, name] = await Promise.all([
    getScreenColumns("drawings.list", organizationId),
    fetchDrawingsList<Drawing>(organizationId, projectId, "drawings"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  // R67 D-65: the project name travels with its id so the pane can name what
  // it is waiting for, and an empty screen can name the project it is empty FOR.
  return (
    <>
      {/* R67 D-07/D-13: the title band names the project this screen queried. */}
      <PageHeading title={HEADING_TITLE} context={name} contextNote={source === "auto" ? "auto-selected" : null} />
      <DrawingsClient projectId={projectId} projectName={name} registryColumns={registryColumns} initial={list} />
    </>
  );
}

export default async function DrawingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
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
        <DrawingsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
