"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ScheduleGanttClient, { type GanttPayload, type RegistryColumn } from "@/components/ScheduleGanttClient";
import ScheduleBoardClient from "@/components/ScheduleBoardClient";
import ScheduleSprintsClient from "@/components/ScheduleSprintsClient";
import ScheduleTimesheetClient from "@/components/ScheduleTimesheetClient";
import { warmSchedule, type ScheduleResource } from "@/lib/schedule-cache";
import { SCHEDULE_TABS, isScheduleTab, type ScheduleTab } from "@/lib/schedule-tabs";

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

// R57 fix for R55_SCHEDULE_TAB_NOT_IN_URL_01: the Timeline/Board/Sprints/
// Timesheet sub-tabs used Radix Tabs' uncontrolled `defaultValue`, so
// switching tabs only ever changed internal component state -- the URL
// never moved (confirmed live 2026-08-27: clicking Board changed the
// rendered panel but location.href stayed at /schedule with no query
// param). That meant refresh, share, and browser back/forward could never
// land back on a non-Timeline tab.
//
// This makes the Tabs value controlled and mirrors it into a `?tab=`
// search param via history.replaceState -- NOT next/navigation's
// router.push/replace, which would re-run the schedule/page.tsx Server
// Component (and its callVeridian calls) on every tab click. The tab
// switch itself stays exactly as instant and client-side as before; only
// the URL bar changes.
//
// R67 F-09 (R-122) -- HOVERING A TAB WARMS IT. Radix unmounts the inactive
// panel, so every tab switch used to start a fresh full-pane spinner, even
// back to a tab the user had already seen. Each trigger now warms its panel's
// request on hover/focus into the shared 60 s session cache
// (src/lib/schedule-cache.ts), and every panel reads through that same cache,
// so the click usually lands on data that is already there -- and a hover
// followed by a click costs ONE request, not two.
const RESOURCE_BY_TAB: Record<ScheduleTab, ScheduleResource> = {
  timeline: "gantt",
  board: "board",
  sprints: "sprints",
  timesheet: "timesheets",
};

export function ScheduleTabsClient({
  projectId,
  initialTab,
  timelineColumns,
  initialGantt = null,
}: {
  projectId: string;
  initialTab: ScheduleTab;
  timelineColumns: RegistryColumn[] | null;
  initialGantt?: GanttPayload | null;
}) {
  function handleTabChange(value: string) {
    if (!isScheduleTab(value)) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", value);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  // Never warms the Timeline when the server already supplied it -- that would
  // reintroduce the request this item removed.
  function warm(tab: ScheduleTab) {
    if (tab === "timeline" && initialGantt !== null) return;
    warmSchedule(RESOURCE_BY_TAB[tab], projectId);
  }

  function triggerProps(tab: ScheduleTab) {
    return { value: tab, onMouseEnter: () => warm(tab), onFocus: () => warm(tab) };
  }

  return (
    <Tabs defaultValue={initialTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger {...triggerProps("timeline")}>Timeline</TabsTrigger>
        <TabsTrigger {...triggerProps("board")}>Board</TabsTrigger>
        <TabsTrigger {...triggerProps("sprints")}>Sprints</TabsTrigger>
        <TabsTrigger {...triggerProps("timesheet")}>Timesheet</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">
        <ScheduleGanttClient projectId={projectId} registryColumns={timelineColumns} initialGantt={initialGantt} />
      </TabsContent>
      <TabsContent value="board">
        <ScheduleBoardClient projectId={projectId} />
      </TabsContent>
      <TabsContent value="sprints">
        <ScheduleSprintsClient projectId={projectId} />
      </TabsContent>
      <TabsContent value="timesheet">
        <ScheduleTimesheetClient projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
