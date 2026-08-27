import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
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
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const timelineColumns = await resolveScheduleTimelineColumns(organizationId);
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
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
            <ScheduleTabsClient projectId={project.id} initialTab={initialTab} timelineColumns={timelineColumns} />
          </>
        )}
      </div>
    </>
  );
}
