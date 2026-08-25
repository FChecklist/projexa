import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import ScheduleGanttClient, { type RegistryColumn } from "@/components/ScheduleGanttClient";
import ScheduleBoardClient from "@/components/ScheduleBoardClient";
import ScheduleSprintsClient from "@/components/ScheduleSprintsClient";
import ScheduleTimesheetClient from "@/components/ScheduleTimesheetClient";

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

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const timelineColumns = await resolveScheduleTimelineColumns(organizationId);

  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Schedule" />
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <>
            <h2 className="font-heading text-lg text-px-ink">{project.name}</h2>
            <Tabs defaultValue="timeline">
              <TabsList>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="board">Board</TabsTrigger>
                <TabsTrigger value="sprints">Sprints</TabsTrigger>
                <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
              </TabsList>
              <TabsContent value="timeline">
                <ScheduleGanttClient projectId={project.id} registryColumns={timelineColumns} />
              </TabsContent>
              <TabsContent value="board">
                <ScheduleBoardClient projectId={project.id} />
              </TabsContent>
              <TabsContent value="sprints">
                <ScheduleSprintsClient projectId={project.id} />
              </TabsContent>
              <TabsContent value="timesheet">
                <ScheduleTimesheetClient projectId={project.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </>
  );
}
