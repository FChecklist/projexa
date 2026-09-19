"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MaterialsClient from "@/components/MaterialsClient";
import LabourDailySummaryClient from "@/components/LabourDailySummaryClient";
import { isoDay } from "@/lib/work-progress-report-params";

// Resources: Materials + Manpower. Manpower uses the compact
// LabourDailySummaryClient (one day's roster/attendance/cost) rather than
// the full tabbed LabourClient -- the workspace card's own job is a
// same-page summary with a link out, not a second copy of the full Labour
// module's own tab set.
export function WorkspaceResourcesCard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [date, setDate] = useState(() => isoDay(new Date()));

  return (
    <Tabs defaultValue="materials">
      <TabsList>
        <TabsTrigger value="materials">Materials</TabsTrigger>
        <TabsTrigger value="manpower">Manpower</TabsTrigger>
      </TabsList>
      <TabsContent value="materials">
        <MaterialsClient projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="manpower">
        <LabourDailySummaryClient projectId={projectId} projectName={projectName} date={date} onDateChange={setDate} />
      </TabsContent>
    </Tabs>
  );
}
