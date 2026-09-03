// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale. /labour was one of the two worst offenders: two serial VERIDIAN
// hops (/dashboard, then /screen-definitions/manpower.list) before the first
// byte, and then three more client fetches -- about 6 s to a usable screen for
// SQL the audit measured as trivial. The frame now streams first and the
// roster, which is the tab this screen opens on, is fetched here on the server
// and handed to LabourClient as props.
//
// R67 F-30 (audit recommendation R-274) restructures what remained.
//
//   THE FRAME STREAMS FIRST. The title is outside every boundary, so the
//   breadcrumb "Manpower & Attendance" is painted at TTFB whatever the backend
//   is doing.
//
//   TWO BOUNDARIES, NOT ONE. The attendance summary and the roster each sit in
//   their own <Suspense>, so neither waits on the other's render and each
//   shows its own skeleton -- with DE-17's "Still loading roster… <n> s" at
//   3 s and "This is taking longer than usual" at 8 s, the same words the
//   client-side panes use (R67 F-31), because a user cannot tell a server wait
//   from a client one and should not have to.
//
//   ...AND STILL ONE ROUND TRIP. Both boundaries call getLabourLanding(),
//   which is React-cache()'d per request, so the second returns the first's
//   promise. Upstream, `includeAttendanceSummary=1` answers the roster AND the
//   day's summary from ONE transaction. Splitting the page without those two
//   things would have doubled its network cost -- the opposite of this item.
//
//   AND IT IS MEASURED. Every upstream call on this page runs inside
//   timeUpstream(), which is a plain pass-through unless DEBUG_LATENCY=1 is
//   set. R-274's first instruction is to profile before restructuring; this is
//   the instrument that makes a second opinion possible without a rebuild.
//
// The org API key never leaves the server (D-04 option A): every call here is
// a server component's, and LabourClient receives rows, not credentials.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { AttendanceSummaryStrip, AttendanceSummaryStripSkeleton } from "@/components/AttendanceSummaryStrip";
import { MANPOWER_LIST_COLUMNS } from "@/lib/module-list-columns";
import {
  getCachedServerOrganizationId,
  getLabourLanding,
  getScreenColumns,
  resolveProjectForModule,
} from "@/lib/module-list-source";
import { timeUpstream } from "@/lib/debug-latency";
// R67 D-32: WS-A's `source` read as "was this chosen FOR the user?". Derived
// through the one shared helper so the rail and this screen cannot disagree.
import { fellBackFrom } from "@/lib/project-selection";
import LabourClient, { type RosterEntry, type RosterFilterState } from "@/components/LabourClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={MANPOWER_LIST_COLUMNS}
    tabs={["Roster", "Attendance"]}
    actions={["Add Worker"]}
    // R67 F-30 / F-31: the words this wait acquires at 3 s. "roster" is the
    // user's own noun for what is in flight -- not a route, not an endpoint.
    label="roster"
  />
);

/**
 * The day the attendance summary is about.
 *
 * The URL wins, because the browser knows the SITE's today and this render
 * does not: a summary computed from the server's own date is the wrong day for
 * a site in Mumbai for five and a half hours out of every twenty-four. The
 * strip always prints the date it is showing, so even the fallback is legible
 * rather than merely assumed.
 */
function summaryDate(requested?: string): string {
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function resolveLanding(requestedProjectId: string | undefined, date: string) {
  const organizationId = await getCachedServerOrganizationId();
  // R67 D-32: `source` and `projectName` come back from the same resolution
  // that produced the id, so naming the project costs no extra hop. On the fast
  // path projectName is null BY DESIGN -- and the fast path is a `?projectId=`
  // or the rail's own cookie, which is a choice the user made, so there is
  // nothing for D-32 to admit to there either. The two nulls agree.
  const { projectId, errorMessage, source, projectName } = await resolveProjectForModule(
    requestedProjectId,
    organizationId
  );
  const resolvedByFallback = fellBackFrom(source);
  if (!projectId) {
    return { organizationId, projectId: null as string | null, errorMessage, projectName, resolvedByFallback, landing: null };
  }
  const landing = await getLabourLanding<RosterEntry>(organizationId, projectId, date);
  return { organizationId, projectId, errorMessage, projectName, resolvedByFallback, landing };
}

async function AttendanceSummarySection({
  requestedProjectId,
  date,
}: {
  requestedProjectId?: string;
  date: string;
}) {
  const { projectId, landing } = await resolveLanding(requestedProjectId, date);
  // No project resolved is NOT this strip's error to report -- the roster
  // section below says so once, with the backend's own words. A second copy of
  // the same message would just be noise.
  if (!projectId || !landing) return null;
  return <AttendanceSummaryStrip summary={landing.attendanceSummary} errorMessage={landing.errorMessage} />;
}

async function LabourSection({
  requestedProjectId,
  tab,
  date,
  // D3 x D21 MERGE (decision D-11): both lanes widened this section's props
  // for different features -- D3's restored filter, D21's import receipt --
  // and neither reads the other's, so both are passed through.
  initialFilter,
  importedNotice,
}: {
  requestedProjectId?: string;
  tab?: string;
  date: string;
  initialFilter: Partial<RosterFilterState>;
  // R67 D-34: `imported` is the confirmation the bulk-import screen hands
  // over; that screen unmounts with the navigation, so it cannot carry its
  // own. It travels down here rather than being read in the client so the
  // receipt is part of the first painted section, not a second render.
  importedNotice?: string | null;
}) {
  const { organizationId, projectId, errorMessage, projectName, resolvedByFallback, landing } = await resolveLanding(
    requestedProjectId,
    date
  );
  if (!projectId || !landing) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const registryColumns = await timeUpstream("labour:screen-definitions", () =>
    getScreenColumns("manpower.list", organizationId)
  );

  return (
    <LabourClient
      projectId={projectId}
      registryColumns={registryColumns}
      initialTab={tab}
      initialRoster={{ rows: landing.roster, errorMessage: landing.errorMessage }}
      // R67 D-32: read server-side so browser Back restores the filter before
      // the first paint rather than after it.
      initialFilter={initialFilter}
      // R67 D-53: the Daily Summary opens on the day the URL names, which is
      // the same day the strip above it is about.
      initialSummaryDate={date}
      // R67 D-32: the page's own answer to "which project, and did anyone
      // actually choose it?" -- so the screen can admit to a guess.
      projectName={projectName}
      resolvedByFallback={resolvedByFallback}
      // R67 D-34 (lane D21): the bulk-import receipt, carried down rather than
      // re-read in the client. Orthogonal to D-32's filter above.
      importedNotice={importedNotice ?? null}
    />
  );
}

export default async function LabourPage({
  searchParams,
}: {
  // D3 x D21 MERGE: the union of both lanes' query parameters. D3 reads the
  // four filter keys (D-32), D21 reads `imported` (D-34); the URL carries all
  // of them and this screen is the only reader of either set.
  searchParams: Promise<{
    projectId?: string;
    tab?: string;
    date?: string;
    q?: string;
    trade?: string;
    company?: string;
    status?: string;
    imported?: string;
  }>;
}) {
  const { projectId, tab, date, q, trade, company, status, imported } = await searchParams;
  const day = summaryDate(date);

  // R67 D-32: only what the URL actually says. An absent parameter must not
  // become an empty string, or "no filter" and "filter for nothing" would be
  // the same request.
  const initialFilter: Partial<RosterFilterState> = {
    ...(q ? { q } : {}),
    ...(trade ? { trade } : {}),
    ...(company ? { company } : {}),
    ...(status === "active" || status === "inactive" || status === "all" ? { status } : {}),
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Outside every boundary: painted at TTFB, whatever the backend does. */}
      <PageHeading title="Manpower & Attendance" />

      <Suspense fallback={<AttendanceSummaryStripSkeleton />}>
        <AttendanceSummarySection requestedProjectId={projectId} date={day} />
      </Suspense>

      <Suspense fallback={SKELETON}>
        <LabourSection
          requestedProjectId={projectId}
          tab={tab}
          date={day}
          initialFilter={initialFilter}
          importedNotice={imported ?? null}
        />
      </Suspense>
    </div>
  );
}
