"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListHeaderActions } from "@/components/ListHeaderActions";
import ScheduleGanttClient, { type RegistryColumn } from "@/components/ScheduleGanttClient";
import ScheduleBoardClient from "@/components/ScheduleBoardClient";
import ScheduleSprintsClient from "@/components/ScheduleSprintsClient";
import ScheduleTimesheetClient from "@/components/ScheduleTimesheetClient";
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
export function ScheduleTabsClient({
  projectId,
  initialTab,
  timelineColumns,
}: {
  projectId: string;
  initialTab: ScheduleTab;
  timelineColumns: RegistryColumn[] | null;
}) {
  // R67 D-79: the Tabs value is CONTROLLED now. It was uncontrolled
  // (`defaultValue`), so this component could not name the tab the user was
  // on -- and the header's "+ New" has to, because which object it offers
  // first is the whole point. The URL sync below is unchanged: still
  // history.replaceState, never router.push, so a tab click does not re-run
  // the page's Server Component and its VERIDIAN calls.
  const [activeTab, setActiveTab] = useState<ScheduleTab>(initialTab);

  function handleTabChange(value: string) {
    if (!isScheduleTab(value)) return;
    setActiveTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", value);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      {/* R67 D-79: the Schedule module had NO header action on any of its
          four tabs, so logging time from the Gantt meant leaving the module
          entirely even though /schedule/log-time has existed all along. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="sprints">Sprints</TabsTrigger>
          <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
        </TabsList>
        <ListHeaderActions
          module="schedule"
          tab={activeTab}
          projectId={projectId}
          filterDisabledReason="Filtering the schedule is not built yet"
          exportDisabledReason="Exporting the schedule is not built yet"
        />
      </div>
      <TabsContent value="timeline">
        <ScheduleGanttClient projectId={projectId} registryColumns={timelineColumns} />
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
