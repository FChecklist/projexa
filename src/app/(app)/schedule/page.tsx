import { Card, CardContent } from "@/components/ui/card";
import { resolveRouteProject } from "@/lib/project-selection";
import { ScreenContext } from "@/components/shell/shell-screen-context";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { type RegistryColumn } from "@/components/ScheduleGanttClient";
import { ScheduleTabsClient } from "@/components/ScheduleTabsClient";
import { isScheduleTab } from "@/lib/schedule-tabs";

// R46 P8 seq130 (M28 registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns and R46 P8 seq121's resolveRegistryColumns in
// scope/page.tsx): resolved server-side so ScheduleGanttClient never needs
// its own Bearer-key-authenticated fetch. A missing or errored registry row
// is NOT fatal -- ScheduleGanttClient falls back to its own hardcoded
// DEFAULT_COLUMNS when this is null.
async function resolveScheduleTimelineColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/schedule.timeline", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[schedule/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// F_016 fix (2026-08-27): isScheduleTab now comes from src/lib/schedule-tabs.ts
// (a plain, non-"use client" module) instead of from ScheduleTabsClient.tsx.
// This Server Component was calling isScheduleTab(tab) directly below, and a
// function exported from a "use client" file becomes an opaque client
// reference when imported into a Server Component -- it can only be rendered
// as a Component or passed as a prop, never invoked. That mismatch 500'd
// every GET /schedule in production with "Attempted to call isScheduleTab()
// from the server but isScheduleTab is on the client" (digest 1240219489,
// confirmed live 2026-08-27, first seen minutes after R57/PR#185 -- which
// introduced this exact call -- went live).
// R67 A-13 -- THIS SCREEN RENDERS STRICTLY FROM THE URL.
//
// It used to call resolveSelectedProject(), whose last resort is the org's
// FIRST project. So /schedule with no ?projectId= showed one project's board,
// timeline, sprints and timesheet under a heading naming that project, with
// nothing on screen admitting the choice had been made for the user -- and the
// top rail, which keeps its own answer, could be naming a different project two
// lines above. A schedule is a project's schedule; guessing which one is the
// same class of mistake as logging progress against the wrong project.
//
// Now: the URL names the project or the page ASKS for one. Ten reloads of
// /schedule?projectId=X render X, every time, whatever the rail remembers.
//
// R67 D-44 reconciliation: this lane redirected to ?projectId=<resolved> when
// the URL named none, to stop the rail and the pane disagreeing. A-13 answers
// the same defect one step earlier and better -- it never resolves a project
// nobody named, so there is nothing to redirect TO and the screen ASKS. The
// redirect is therefore retired rather than kept beside it; keeping both would
// mean a page that both refuses to guess and navigates to its own guess.
// `q` and `highlight` stay: they are this lane's filter and the "the row you
// just created" mark, and they are read by ScheduleTabsClient below.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; q?: string; highlight?: string }>;
}) {
  const { projectId, tab, q, highlight } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage, source, missing, unreachable } = await resolveRouteProject(
    { projectId },
    null,
    organizationId
  );
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  const timelineColumns = project ? await resolveScheduleTimelineColumns(organizationId) : null;

  return (
    <>
      {/* The shell's rail and strip name what this pane is actually showing --
          including the case where it is showing nothing because no project was
          named, which is a fact the top rail must not paper over. */}
      <ScreenContext moduleId="schedule" project={project} source={source ?? "route"} />
      {/* R67 D-44: no bare <PageHeading title="Schedule" /> here -- the header
          band (breadcrumb "Schedule > {project}" plus Filter | Export | Import
          | + New in that fixed order) is rendered by ScheduleTabsClient through
          the forked ScreenFrame, because every one of those actions needs a
          client handler and the project's own name. Rendering both would put
          two headings on one screen. */}
      <div className="flex-1 space-y-6 p-6">
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
          <ScheduleTabsClient
            projectId={project.id}
            projectName={project.name}
            initialTab={initialTab}
            initialQuery={q ?? ""}
            highlightEntryId={highlight}
            timelineColumns={timelineColumns}
          />
        )}
      </div>
    </>
  );
}
