"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PermitsListClient from "@/components/PermitsListClient";
import DrawingsClient from "@/components/DrawingsClient";
import DocumentsClient from "@/components/DocumentsClient";
import MoMsClient from "@/components/MoMsClient";
import { defaultMomsRange } from "@/lib/moms-list";

// Records: Permits/Drawings/Documents/Minutes of Meeting, each reusing its
// own real list component and real API unchanged -- this card is purely a
// tabbed container, no data logic of its own beyond the constant defaults
// MoMsClient's own page.tsx already establishes (mode is always "project"
// here: a workspace page belongs to one named project, never the
// all-projects mode /moms itself also supports).
export function WorkspaceRecordsCard({ projectId, projectName }: { projectId: string; projectName: string }) {
  const today = new Date();
  const defaultFilter = { status: "", attendee: "", ...defaultMomsRange(today) };

  return (
    <Tabs defaultValue="permits">
      <TabsList>
        <TabsTrigger value="permits">Permits</TabsTrigger>
        <TabsTrigger value="drawings">Drawings</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="moms">Minutes of Meeting</TabsTrigger>
      </TabsList>
      <TabsContent value="permits">
        <PermitsListClient projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="drawings">
        <DrawingsClient projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentsClient projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="moms">
        <MoMsClient
          projectId={projectId}
          projectName={projectName}
          mode="project"
          fellBack={false}
          projects={[]}
          initialFilter={defaultFilter}
          defaultFilter={defaultFilter}
        />
      </TabsContent>
    </Tabs>
  );
}
