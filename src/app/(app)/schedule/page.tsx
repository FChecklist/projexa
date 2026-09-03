// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone and the frame streams first. The tab clients still fetch their own
// data (the four tabs read four different backends); per-tab loading is F-25.
//
// *** MERGE NOTE (F-18 x WS-A A-13). ***
//
// These two items pull in opposite directions on THIS screen only, and the
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

const SKELETON = (
  <ModuleListSkeletonBody
    columns={SCHEDULE_TIMELINE_COLUMNS}
    tabs={["Timeline", "Board", "Sprints", "Timesheet"]}
  />
);

async function ScheduleSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
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
  const timelineColumns = await getScreenColumns("schedule.timeline", organizationId);
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
        <>
          <h2 className="font-heading text-lg text-px-ink">{project.name}</h2>
          <ScheduleTabsClient projectId={project.id} initialTab={initialTab} timelineColumns={timelineColumns} />
        </>
      )}
    </>
  );
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Schedule" />
      <Suspense fallback={SKELETON}>
        <ScheduleSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
