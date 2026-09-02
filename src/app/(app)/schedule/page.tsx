import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { callVeridian, VERIDIAN_PAGE_BUDGET_MS } from "@/lib/veridian-client";
import { type GanttPayload, type RegistryColumn } from "@/components/ScheduleGanttClient";
import { ScheduleTabsClient } from "@/components/ScheduleTabsClient";
import { ScheduleSkeleton } from "@/components/ScheduleSkeleton";
import { isScheduleTab } from "@/lib/schedule-tabs";

// F_016 fix (2026-08-27): isScheduleTab comes from src/lib/schedule-tabs.ts
// (a plain, non-"use client" module) instead of from ScheduleTabsClient.tsx.
// This Server Component calls isScheduleTab(tab) directly below, and a
// function exported from a "use client" file becomes an opaque client
// reference when imported into a Server Component -- it can only be rendered
// as a Component or passed as a prop, never invoked. That mismatch 500'd
// every GET /schedule in production with "Attempted to call isScheduleTab()
// from the server but isScheduleTab is on the client" (digest 1240219489,
// confirmed live 2026-08-27, first seen minutes after R57/PR#185 -- which
// introduced this exact call -- went live).
//
// R67 F-09 (R-122), D-04 option A. /schedule had a 2.1 s TTFB and THEN a
// client-side spinner: the page resolved the project and the registry row
// serially before sending HTML, and the Timeline tab only started fetching its
// gantt once it had hydrated.
//
//   1. the heading streams immediately; the tab area sits behind <Suspense>
//      with a ScheduleSkeleton fallback, so HTML paints without waiting;
//   2. the project resolves first (the gantt needs its id), then the registry
//      row and the gantt run in ONE Promise.all;
//   3. the gantt result is handed to ScheduleGanttClient as initialGantt, so
//      the stat tiles and the All-tasks table are on the FIRST render -- the
//      client only fetches again on Retry;
//   4. schedule.timeline is a static registry row, memoised per org for
//      10 minutes; the project list for 60 s.
//
// The gantt call carries D-04's 8 s budget: this is the one blocking call on
// the page, and a screen should say "couldn't load, Retry" long before the
// 20 s upstream ceiling.
const TIMELINE_COLUMNS_TTL_SECONDS = 600;
const PROJECT_TTL_SECONDS = 60;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Schedule" />
      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleSection projectId={projectId} initialTab={initialTab} />
      </Suspense>
    </div>
  );
}

async function ScheduleSection({ projectId, initialTab }: { projectId?: string; initialTab: "timeline" | "board" | "sprints" | "timesheet" }) {
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId, { cacheSeconds: PROJECT_TTL_SECONDS });

  if (errorMessage) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
      </Card>
    );
  }
  if (!project) {
    return <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>;
  }

  // Parallel: the column labels do not depend on the gantt, and the gantt does
  // not depend on the labels.
  const [timelineColumns, initialGantt] = await Promise.all([
    resolveRegistryColumns("schedule.timeline", organizationId, TIMELINE_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
    resolveInitialGantt(project.id, organizationId),
  ]);

  return (
    <>
      <h2 className="font-heading text-lg text-px-ink">{project.name}</h2>
      <ScheduleTabsClient
        projectId={project.id}
        initialTab={initialTab}
        timelineColumns={timelineColumns}
        initialGantt={initialGantt}
      />
    </>
  );
}

// Never throws: a failed gantt returns null and ScheduleGanttClient falls back
// to fetching it itself, showing the real error with a Retry. The page must
// still render its other three tabs when the timeline's data is unavailable.
async function resolveInitialGantt(projectId: string, organizationId: string | null): Promise<GanttPayload | null> {
  try {
    return await callVeridian<GanttPayload>(`/schedule/gantt?projectId=${encodeURIComponent(projectId)}`, {
      organizationId: organizationId ?? undefined,
      timeoutMs: VERIDIAN_PAGE_BUDGET_MS,
    });
  } catch (err) {
    console.error("[schedule/page] gantt prefetch failed, the client will retry:", err instanceof Error ? err.message : err);
    return null;
  }
}
