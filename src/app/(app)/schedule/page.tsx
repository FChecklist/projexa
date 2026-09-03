// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone and the frame streams first.
//
// *** MERGE NOTE (F-18 x WS-A A-13 x F-09). ***
//
// F-18 and A-13 pull in opposite directions on THIS screen only, and the
// resolution is to separate what each is actually about.
//
// F-18 is about WHEN the frame paints. A-13 is about WHICH project the screen
// is allowed to show: "/schedule renders strictly from the URL's projectId and
// shows the sentence 'Pick a project' when absent instead of defaulting to the
// first project" -- a schedule is a project's schedule, and guessing which one
// is the same class of mistake as logging progress against the wrong project.
//
// F-18's generic helper (resolveProjectForModule) does the opposite of A-13: it
// falls back to the rail's remembered cookie and then to the org's first
// project. So this page does NOT use it. A-13's rule wins outright on the
// question of which project, because it is a correctness ruling and F-18 is a
// latency one.
//
// What F-18 keeps here, and loses nothing by: the resolution runs INSIDE the
// Suspense boundary, so the heading, the four real tab labels, the timeline's
// column heads and the skeleton rows are on screen while it happens. The user
// sees the frame at once and then either their project's board or the sentence
// asking them to pick one -- never a spinner over the whole page, and never
// another project's board under this project's heading.
//
// F-09 (R-122) is the third item on this file, and it is additive to both: the
// Timeline tab used to start fetching its gantt only after it had hydrated, so
// the tab that opens by default showed a client-side spinner under an
// already-painted frame. The gantt is now fetched HERE, beside the registry
// columns in ONE Promise.all, and handed to ScheduleGanttClient as
// `initialGantt`, so the stat tiles and the All-tasks table are on the FIRST
// render. It is a PREFETCH, never a blocker: resolveInitialGantt() cannot
// throw, and a null answer simply leaves the client to fetch and retry exactly
// as it did before. It runs only once a project has resolved, so A-13's
// "Pick a project" path costs no call at all.
//
// F_016 fix (2026-08-27) is preserved: isScheduleTab comes from
// src/lib/schedule-tabs.ts (a plain, non-"use client" module), NOT from
// ScheduleTabsClient.tsx. A function exported from a "use client" file becomes
// an opaque client reference when imported into a Server Component -- it can
// only be rendered or passed as a prop, never invoked -- and calling it here
// 500'd every GET /schedule in production (digest 1240219489).
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { Card, CardContent } from "@/components/ui/card";
import { SCHEDULE_TIMELINE_COLUMNS } from "@/lib/module-list-columns";
import { getScreenColumns } from "@/lib/module-list-source";
import { resolveRouteProject } from "@/lib/project-selection";
import { ScreenContext } from "@/components/shell/shell-screen-context";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { ScheduleTabsClient } from "@/components/ScheduleTabsClient";
import { isScheduleTab } from "@/lib/schedule-tabs";
import { callVeridian, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";
import { type GanttPayload } from "@/components/ScheduleGanttClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={SCHEDULE_TIMELINE_COLUMNS}
    tabs={["Timeline", "Board", "Sprints", "Timesheet"]}
  />
);

/**
 * R67 F-09. The Timeline tab's own payload, prefetched on the server.
 *
 * Deliberately swallowing: this is an optimisation, not a dependency. A failure
 * here must leave the screen exactly as it was before F-09 -- the client fetches
 * it itself and shows its own error with Retry -- never take down a page that
 * has three other tabs. It carries D-04's 8 s page budget rather than the 20 s
 * upstream ceiling, because a prefetch that outlives the frame it was meant to
 * fill has stopped being a prefetch.
 */
async function resolveInitialGantt(projectId: string, organizationId: string | null): Promise<GanttPayload | null> {
  try {
    return await callVeridian<GanttPayload>(`/schedule/gantt?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: organizationId ?? undefined,
      timeoutMs: VERIDIAN_SCREEN_BUDGET_MS,
    });
  } catch (err) {
    console.error("[schedule/page] gantt prefetch failed, the client will retry:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function ScheduleSection({
  requestedProjectId,
  tab,
  query,
  highlight,
}: {
  requestedProjectId?: string;
  tab?: string;
  /** R67 D-44: the `?q=` filter, read server-side so Back restores it. */
  query?: string;
  /** R67 D-50: `?highlight=` -- the time entry just written, to mark and to receipt. */
  highlight?: string;
}) {
  const organizationId = await getServerOrganizationId();
  // A-13: the URL, or nothing. No cookie fallback and no "first project".
  const { project, errorMessage, source, missing, unreachable } = await resolveRouteProject(
    { projectId: requestedProjectId },
    null,
    organizationId
  );
  // Identical to A-13's own resolveScheduleTimelineColumns (same path, same
  // 404-is-normal fallback to ScheduleGanttClient's hardcoded DEFAULT_COLUMNS),
  // but cached an hour per org by F-18 rather than re-fetched on every render.
  // F-09: the gantt does not depend on the labels and the labels do not depend
  // on the gantt, so they are one batch, not two hops.
  const [timelineColumns, initialGantt] = await Promise.all([
    getScreenColumns("schedule.timeline", organizationId),
    project ? resolveInitialGantt(project.id, organizationId) : Promise.resolve(null),
  ]);
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  return (
    <>
      {/* The shell's rail and strip name what this pane is actually showing --
          including the case where it is showing nothing because no project was
          named, which is a fact the top rail must not paper over. */}
      <ScreenContext moduleId="schedule" project={project} source={source ?? "route"} />
      {errorMessage && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
        </Card>
      )}
      {missing && (
        // The sentence asks for the one decision that is missing. No rows are
        // rendered underneath it: an empty board beside "Pick a project" would
        // read as "this project has no tasks".
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">Pick a project</CardContent>
        </Card>
      )}
      {unreachable && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-px-muted">
            That project is not on your list — pick a project
          </CardContent>
        </Card>
      )}
      {project && (
        // R67 D-44: no <h2>{project.name}</h2> here -- the module's header band
        // (breadcrumb "Schedule > {project}" plus Filter | Export | Import |
        // + New in that fixed order) names the project, and every one of those
        // actions needs a client handler. Two places naming the same project is
        // how the rail and the pane came to disagree in the first place.
        <ScheduleTabsClient
          projectId={project.id}
          projectName={project.name}
          initialTab={initialTab}
          initialQuery={query ?? ""}
          highlightEntryId={highlight}
          timelineColumns={timelineColumns}
          initialGantt={initialGantt}
        />
      )}
    </>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; q?: string; highlight?: string }>;
}) {
  const { projectId, tab, q, highlight } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Schedule" />
      <Suspense fallback={SKELETON}>
        <ScheduleSection requestedProjectId={projectId} tab={tab} query={q} highlight={highlight} />
      </Suspense>
    </div>
  );
}
