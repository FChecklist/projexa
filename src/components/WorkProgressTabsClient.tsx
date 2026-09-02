"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WorkProgressPageClient from "@/components/WorkProgressPageClient";
import WorkProgressReportClient from "@/components/WorkProgressReportClient";
import WorkProgressAnalyticalClient from "@/components/WorkProgressAnalyticalClient";
import { WorkProgressDataProvider } from "@/components/WorkProgressDataProvider";
import { prewarmReport, defaultReportRange } from "@/lib/work-progress-report-prewarm";

// R67 F-05 (R-075). The three tabs were mounted directly by the server page,
// so each one loaded the project's data from scratch: switching from Daily
// Entry to Analytics re-ran the whole entries + activities + /api/scope +
// /api/scope/{id} chain. They share one WorkProgressDataProvider now, keyed by
// project, so a tab switch inside its 60 s window costs nothing.
//
// The Report tab is different: its handler fans out six VERIDIAN calls (2.7 s
// measured), and it cannot share the provider because it is a different query
// entirely. It gets the other treatment -- the request starts on hover/focus
// of the tab itself, so by the time the panel mounts the wait is what is LEFT
// of the request rather than all of it.
export default function WorkProgressTabsClient({ projectId, tab }: { projectId: string; tab?: string }) {
  const warmReport = () => prewarmReport({ projectId, ...defaultReportRange() });

  return (
    <WorkProgressDataProvider projectId={projectId}>
      {/* R42 seq24: "analytics" is a real 3rd tab -- DASHBOARD.PROJECT's own
          destination for the "% Complete by Value" and category-bar KPIs
          (?tab=analytics from DashboardProjectClient). defaultValue reads the
          real ?tab= so a dashboard click lands directly on it. */}
      <Tabs defaultValue={tab === "analytics" || tab === "report" ? tab : "entry"} className="space-y-4">
        <TabsList>
          <TabsTrigger value="entry">Daily Entry</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="report" onMouseEnter={warmReport} onFocus={warmReport}>
            Report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="h-[calc(100vh-14rem)] min-h-[560px]">
          <WorkProgressPageClient projectId={projectId} />
        </TabsContent>
        <TabsContent value="analytics" className="h-[calc(100vh-14rem)] min-h-[560px]">
          <WorkProgressAnalyticalClient projectId={projectId} />
        </TabsContent>
        <TabsContent value="report">
          <WorkProgressReportClient projectId={projectId} />
        </TabsContent>
      </Tabs>
    </WorkProgressDataProvider>
  );
}
