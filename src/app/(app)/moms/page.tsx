// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the meetings are fetched here on the
// server inside the Suspense boundary and handed to MoMsClient as props.
//
// R67 MERGE (lane D0 x lane F2). This page carries more than any other module
// page and BOTH lanes' work is kept:
//
//   * D-20's honest all-projects mode, which matters here more than anywhere
//     else -- minutes typed under a silently-chosen project can be Published,
//     which locks them server-side (assertEditable), so the wrong answer is
//     not just wrong, it is irreversible.
//   * D-16's filters (status, from, to, attendee) read on the SERVER: "the
//     last 90 days" needs a notion of today, and computing it during a client
//     render would produce a different string from the server's pass (the
//     hydration class format-date.ts exists to prevent). Reading them here is
//     also what makes the browser's own Back button restore the filter.
//   * A-03's ScreenContext, so the rail and the composer's strip name the same
//     project the pane is showing.
//   * F-18's streaming: the title is outside the network entirely and the list
//     is fetched server-side, so MoMsClient makes no round trip on first paint.
//
// The one structural compromise: the heading sits INSIDE the boundary because
// D0 gives it the project's name and the "(auto-selected)" note, which cannot
// be known without resolving the project. The Suspense fallback renders the
// same heading without them, so the words still paint at TTFB and only the
// context fills in late.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { MOMS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchMomsList, getScreenColumns } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveSelectedProject } from "@/lib/project-selection";
import { defaultMomsRange, parseMomsFilter, type MomsFilter } from "@/lib/moms-list";
import MoMsClient, { type Meeting } from "@/components/MoMsClient";
import { ScreenContext } from "@/components/shell/shell-screen-context";

// R67 D-17: `deleted` is the receipt the object page hands over when a draft
// meeting is soft-deleted -- that page unmounts with the navigation, so it
// cannot carry its own confirmation.
type MoMsSearchParams = { projectId?: string; status?: string; from?: string; to?: string; attendee?: string; deleted?: string };

const SKELETON = (
  <>
    <PageHeading title="Minutes of Meeting" />
    <ModuleListSkeletonBody columns={MOMS_LIST_COLUMNS} actions={["New Meeting"]} />
  </>
);

async function MoMsSection({ params }: { params: MoMsSearchParams }) {
  const organizationId = await getServerOrganizationId();
  // R67 D-20 opts this screen into the all-projects mode; R67 A-03 needs the
  // SOURCE so the rail can admit to a choice the user did not make. One call
  // answers both -- `fellBack` is derived from `source`, so the heading's
  // "(auto-selected)" and the rail's cannot disagree.
  const { project, projects, errorMessage, mode, fellBack, source } = await resolveSelectedProject(
    params.projectId,
    organizationId,
    { allProjectsWhenUnset: true }
  );

  const today = new Date();
  const range = defaultMomsRange(today);
  const defaultFilter: MomsFilter = { status: "", attendee: "", ...range };
  const initialFilter = parseMomsFilter(
    new URLSearchParams(
      Object.entries(params)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([k, v]) => [k, v])
    ),
    today
  );

  // The registry columns never block: getScreenColumns caches them for an hour
  // per org and answers a 404 -- the normal state for an unseeded screen --
  // with the hardcoded fallback.
  //
  // The prefetched list is exactly the read MoMsClient's own load() makes
  // (`/api/moms?projectId=`, unfiltered): the filter is applied in the client,
  // over the full set, which is what makes "N meetings exist outside this
  // range" answerable at all. So seeding is safe for any filter. In
  // all-projects mode there is no project-scoped list to prefetch and the
  // client asks for the org scope itself.
  const [registryColumns, list] = await Promise.all([
    getScreenColumns("moms.list", organizationId),
    project ? fetchMomsList<Meeting>(organizationId, project.id, "meeting minutes") : Promise.resolve(null),
  ]);

  return (
    <>
      {/* R67 A-03: tell the shell what this screen resolved, so the top rail
          and the composer's strip name the same project the pane is showing
          instead of reading "All projects" beside one project's meetings. */}
      <ScreenContext moduleId="moms" project={project} source={source ?? "auto"} />
      <PageHeading
        title="Minutes of Meeting"
        context={project ? project.name : mode === "all" ? "All projects" : null}
        contextNote={fellBack ? "(auto-selected)" : null}
      />
      {errorMessage && <ModuleProjectNotice errorMessage={errorMessage} />}
      {!errorMessage && (
        <MoMsClient
          projectId={project?.id ?? null}
          projectName={project?.name ?? null}
          mode={mode}
          fellBack={fellBack}
          projects={projects}
          initialFilter={initialFilter}
          defaultFilter={defaultFilter}
          registryColumns={registryColumns}
          initial={list}
          // R67 D-17: the soft-delete receipt, carried across the navigation
          // the object page made on its way out.
          deletedTitle={params.deleted ?? null}
        />
      )}
    </>
  );
}

export default async function MoMsPage({ searchParams }: { searchParams: Promise<MoMsSearchParams> }) {
  const params = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <Suspense fallback={SKELETON}>
        <MoMsSection params={params} />
      </Suspense>
    </div>
  );
}
