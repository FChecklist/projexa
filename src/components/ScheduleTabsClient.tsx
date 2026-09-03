"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ScheduleGanttClient, { type RegistryColumn } from "@/components/ScheduleGanttClient";
import ScheduleBoardClient from "@/components/ScheduleBoardClient";
import ScheduleSprintsClient from "@/components/ScheduleSprintsClient";
import ScheduleTimesheetClient from "@/components/ScheduleTimesheetClient";
import { PageHeading } from "@/components/PageHeading";
import { ListHeaderActions } from "@/components/ListHeaderActions";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { SCHEDULE_TABS, isScheduleTab, type ScheduleTab } from "@/lib/schedule-tabs";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";
import { durationDays, formatDurationDays } from "@/lib/schedule-progress";

// F_016 fix (2026-08-27): SCHEDULE_TABS / ScheduleTab / isScheduleTab used to
// be defined in this file. This file is "use client", and
// schedule/page.tsx (a Server Component) imported isScheduleTab from here
// and CALLED it directly while resolving initialTab -- a function exported
// from a "use client" module becomes an opaque client reference when
// imported into a Server Component, so invoking it server-side throws
// "Attempted to call isScheduleTab() from the server but isScheduleTab is
// on the client", which 500'd every GET /schedule in production (confirmed
// live 2026-08-27, digest 1240219489). Moved to src/lib/schedule-tabs.ts,
// which has no "use client" directive, and re-exported here so anything
// that imports these three from this file keeps working unchanged.
export { SCHEDULE_TABS, isScheduleTab, type ScheduleTab };

// R57 fix for R55_SCHEDULE_TAB_NOT_IN_URL_01: the sub-tabs used Radix Tabs'
// uncontrolled `defaultValue`, so switching tabs only ever changed internal
// component state -- the URL never moved. The value is controlled here and
// mirrored into `?tab=` via history.replaceState -- NOT router.push/replace,
// which would re-run schedule/page.tsx's Server Component (and its
// callVeridian calls) on every tab click.
//
// ─── R67 D-44 (audit R-118 / R-120 / R-126) ─────────────────────────────────
// Four defects, all of them the module refusing to behave like the rest of the
// product:
//
//   * The page's header was a bare <PageHeading title="Schedule" /> -- no
//     breadcrumb, no project, and none of the header actions every other module
//     now has. This component now owns the standard header band, in the fixed
//     order Filter | Export | Import | + New.
//
//     MERGE NOTE (D-79): that band was originally a fork of the kit's
//     ScreenFrame, made only to fit a fourth action. Lane D-79's
//     ListHeaderActions -- already on main and already carrying Manpower and
//     Materials -- is the product's real answer to the same requirement, and it
//     brings the "+ New" MENU this fork never had. The fork is therefore
//     retired and this screen uses the shared control, with Import passed
//     through its `extraActions` slot so the four-action order still holds.
//     PageHeading (which grew a breadcrumb slot for D-32) renders the trail.
//   * '+ New Task' lived inside the Board tab's body, so on Timeline, Phases or
//     Time there was no way to create an activity at all. It is in the header
//     band now, so it exists on every tab.
//   * The tabs were labelled with the data model's words (Sprints, Timesheet).
//     The VISIBLE labels are now Timeline | Board | Phases | Time; the tab
//     VALUES are unchanged (timeline|board|sprints|timesheet) so every existing
//     ?tab= link keeps working.
//   * A tab said nothing about what it was for. Each now carries one muted
//     caption under the TabsList.
//
// WHY THIS COMPONENT FETCHES THE ACTIVITY LIST TOO. Filter and Export are
// header actions, so they must know whether there are any activities BEFORE the
// Timeline tab has mounted (Radix unmounts inactive tab content, so the Gantt's
// own list is unavailable on the other three tabs). This is one small GET
// against the same /api/schedule/tasks route /schedule/log-time already uses --
// deliberately not a second copy of the Gantt's heavier /api/schedule/gantt
// call, which additionally computes the critical path.
const TAB_LABELS: Record<ScheduleTab, string> = {
  timeline: "Timeline",
  board: "Board",
  sprints: "Phases",
  timesheet: "Time",
};

const TAB_CAPTIONS: Record<ScheduleTab, string> = {
  timeline: "Your programme. Import an Excel plan or add activities; bars show planned (grey) and actual (blue).",
  board: "Move activities between statuses by dragging.",
  sprints: "Group activities into phases and close them when done.",
  timesheet: "Hours logged against activities.",
};

export const NO_ACTIVITIES_TO_FILTER = "No activities to filter";
export const NO_ACTIVITIES_TO_EXPORT = "No activities to export";

// D-44: "'Import' pushes /schedule/import (shipped by C04-07, so add that route
// to SHIPPED_ROUTES in src/lib/nav-routes.ts only when C04-07 merges)".
//
// C04-07 has not merged: there is no src/app/(app)/schedule/import/page.tsx in
// this repo or on origin/main, so wiring the click would push the user into a
// framework 404 -- the exact defect D-50 exists to stop. The action holds its
// place in the fixed order and says why it cannot be used, which is the
// programme's own rule for a control that is not yet reachable.
//
// WHEN C04-07 MERGES: delete this constant, give the action
// `onClick: () => router.push("/schedule/import")`, and add "/schedule/import"
// to SHIPPED_ROUTES (nav-routes.test.ts fails in both directions).
export const IMPORT_UNAVAILABLE_REASON = "Not available yet";

const FILTER_PARAM = "q";

type ScheduleTask = {
  id: string;
  number?: number;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  completionPercentage?: number;
  priority?: string;
};

export function ScheduleTabsClient({
  projectId,
  projectName,
  initialTab,
  initialQuery = "",
  highlightEntryId,
  timelineColumns,
}: {
  projectId: string;
  projectName: string;
  initialTab: ScheduleTab;
  /** The `?q=` filter, read server-side so Back restores it before the first paint. */
  initialQuery?: string;
  /** R67 D-50: `?highlight=` -- the time entry just written, to mark and to receipt. */
  highlightEntryId?: string;
  timelineColumns: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ScheduleTab>(initialTab);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(initialQuery.length > 0);
  const [query, setQuery] = useState(initialQuery);
  // The persistent footer message area (M29: "toasts vanish; errors must
  // persist until resolved"). The tab contents push into it -- D-45's baseline
  // failures and D-50's time-logged receipt both land here.
  const [messages, setMessages] = useState<FieldMessage[]>([]);

  const pushMessage = useCallback((message: FieldMessage | null, field: string) => {
    setMessages((current) => {
      const kept = current.filter((m) => m.field !== field);
      return message ? [...kept, { ...message, field }] : kept;
    });
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const data = await fetchJson<{ tasks?: ScheduleTask[] }>(
        `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`
      );
      setTasks(data.tasks ?? []);
      setTasksError(null);
      pushMessage(null, "activities");
    } catch (err) {
      setTasks([]);
      const message = errorMessage(err, "Couldn't load this project's activities");
      setTasksError(message);
      // Never a silent header: the two actions that depend on this list say
      // they cannot be used, and the footer says why, in the backend's own
      // words rather than a shrug.
      pushMessage({ level: "error", text: message }, "activities");
    } finally {
      setTasksLoading(false);
    }
  }, [projectId, pushMessage]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  /** One writer for the URL, so the tab and the filter never overwrite each other. */
  const writeUrl = useCallback((next: { tab?: ScheduleTab; query?: string }) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next.tab) params.set("tab", next.tab);
    if (next.query !== undefined) {
      if (next.query) params.set(FILTER_PARAM, next.query);
      else params.delete(FILTER_PARAM);
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  function handleTabChange(value: string) {
    if (!isScheduleTab(value)) return;
    setTab(value);
    writeUrl({ tab: value });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    writeUrl({ query: value });
  }

  function exportActivities() {
    const rows = tasks.map((t, i) => [
      i + 1,
      t.number ?? "",
      t.title,
      t.startDate ?? "",
      t.dueDate ?? "",
      formatDurationDays(durationDays(t.startDate, t.dueDate)),
      t.completionPercentage ?? 0,
      (t.priority ?? "").replace(/_/g, " "),
    ]);
    const csv = toCsv(
      ["S.No", "No.", "Activity", "Start", "Due", "Duration", "% Complete", "Priority"],
      rows
    );
    downloadCsv(csvFilename("schedule", projectName, new Date().toISOString().slice(0, 10)), csv);
  }

  // Stable per-field callbacks. An inline arrow here would hand each child a
  // NEW function on every render, and a child that keys an effect off it would
  // fetch in a loop -- the children hold it in a ref for exactly that reason,
  // and this is the other half of the same defence.
  const onBaselineMessage = useCallback((message: FieldMessage | null) => pushMessage(message, "baseline"), [pushMessage]);
  const onTimesheetMessage = useCallback((message: FieldMessage | null) => pushMessage(message, "timesheet"), [pushMessage]);

  const emptyReasonFor = (reason: string) =>
    tasksLoading ? "Loading…" : tasksError ? "Activities did not load" : tasks.length === 0 ? reason : undefined;

  // ListHeaderActions decides "disabled" by the ABSENCE of a handler, so the
  // two have to agree: a handler is passed only when there is something for it
  // to act on, and the reason above is what the control then says.
  const tasksReady = !tasksLoading && !tasksError && tasks.length > 0;

  const breadcrumb = useMemo(
    () => (
      <span>
        Schedule <span aria-hidden>&gt;</span>{" "}
        <span className="font-medium text-[color:var(--color-veri-status-context)]">{projectName}</span>
      </span>
    ),
    [projectName]
  );

  return (
    <div className="space-y-4">
      {/* A real <header>: this band is the screen's header, and D-44's
          acceptance -- four actions, in a fixed order, over a breadcrumb that
          names the project -- is stated over it. */}
      <header className="flex flex-wrap items-end justify-between gap-2">
        {/* The TITLE is the page's, painted at TTFB outside every Suspense
            boundary (F-30). This band carries the trail and the actions, which
            both need the project's name and a client handler. Two "Schedule"
            headings on one screen is what dropping it here avoids. */}
        <p className="text-[12px] text-px-muted">{breadcrumb}</p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <ListHeaderActions
          module="schedule"
          tab={tab}
          projectId={projectId}
          onFilter={tasksReady ? () => setFilterOpen((open) => !open) : undefined}
          filterDisabledReason={emptyReasonFor(NO_ACTIVITIES_TO_FILTER)}
          onExport={tasksReady ? exportActivities : undefined}
          exportDisabledReason={emptyReasonFor(NO_ACTIVITIES_TO_EXPORT)}
          extraActions={
            // D-44's fourth action, in its fixed place between Export and
            // "+ New". Disabled with a real reason rather than wired, because
            // /schedule/import does not exist yet -- see IMPORT_UNAVAILABLE_REASON.
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              title={IMPORT_UNAVAILABLE_REASON}
              data-testid="schedule-import"
            >
              Import
            </Button>
          }
        />
      </div>
      </header>

      <div className="space-y-4 px-4 py-3">
        {/* ONE Radix Tabs root around the list AND the panels: two roots would
            break the aria-controls pairing and the roving focus between the
            triggers and their panels. The "+ New Task" button sits in the same
            flex row as the TabsList rather than inside a panel, which is what
            "exists on every tab" means in practice. */}
        <Tabs value={tab} onValueChange={handleTabChange}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              {SCHEDULE_TABS.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {TAB_LABELS[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <p className="mt-2 text-[13px] text-px-muted">{TAB_CAPTIONS[tab]}</p>

          {filterOpen && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-px-border bg-px-cloud/40 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-filter-title">Activity contains</Label>
                <Input
                  id="schedule-filter-title"
                  className="w-64"
                  value={query}
                  placeholder="e.g. slab"
                  onChange={(e) => handleQueryChange(e.target.value)}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleQueryChange("")}>
                Clear
              </Button>
            </div>
          )}

          <TabsContent value="timeline">
            <ScheduleGanttClient
              projectId={projectId}
              registryColumns={timelineColumns}
              titleFilter={query}
              onMessage={onBaselineMessage}
            />
          </TabsContent>
          <TabsContent value="board">
            <ScheduleBoardClient projectId={projectId} />
          </TabsContent>
          <TabsContent value="sprints">
            <ScheduleSprintsClient projectId={projectId} />
          </TabsContent>
          <TabsContent value="timesheet">
            <ScheduleTimesheetClient
              projectId={projectId}
              projectName={projectName}
              highlightEntryId={highlightEntryId}
              onMessage={onTimesheetMessage}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* M29: "toasts vanish; errors must persist until resolved". ScreenFrame
          used to render this region; it is rendered here now, unchanged in
          behaviour -- D-45's baseline failures and D-50's time-logged receipt
          both land in it. */}
      {messages.length > 0 && (
        <div className="space-y-1 px-4 pb-3">
          {messages.map((message) => (
            <p
              key={message.field}
              role={message.level === "error" ? "alert" : "status"}
              className={`text-[13px] ${message.level === "error" ? "text-px-error" : "text-px-muted"}`}
            >
              {message.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
