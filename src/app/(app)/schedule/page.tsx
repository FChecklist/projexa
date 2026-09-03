import { redirect } from "next/navigation";
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
//
// R67 D-44: the bare <PageHeading title="Schedule" /> is gone -- the header
// band (breadcrumb "Schedule > {project}" plus Filter | Export | Import |
// + New in that fixed order) is rendered by ScheduleTabsClient through the
// forked ScreenFrame, because every one of those actions needs a client
// handler and the project's own name.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; tab?: string; q?: string }>;
}) {
  const { projectId, tab, q } = await searchParams;
  const organizationId = await getServerOrganizationId();
  const { project, errorMessage } = await resolveSelectedProject(projectId, organizationId);
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  // R67 D-44, the projexa half of the WS-A "root = top rail OR route projectId"
  // rule: when this page resolved a project but the URL did not name one, make
  // the URL say so. Without this the top rail, the composer and the data calls
  // could each be on a different project with nothing on screen admitting it --
  // and browser Back from an activity landed on a /schedule with no projectId,
  // which then re-resolved to whatever the fallback happened to be.
  //
  // redirect() must not be called inside a try/catch: it works by throwing.
  // Next.js answers a GET with a real 3xx, so this REPLACES the history entry
  // rather than adding one -- Back still leaves the module in one step.
  if (project && !projectId) {
    const params = new URLSearchParams({ projectId: project.id });
    if (tab) params.set("tab", tab);
    if (q) params.set("q", q);
    redirect(`/schedule?${params.toString()}`);
  }

  const timelineColumns = project ? await resolveScheduleTimelineColumns(organizationId) : null;

  return (
    <>
      <div className="flex-1 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">Could not load projects: {errorMessage}</CardContent>
          </Card>
        )}
        {!errorMessage && !project && (
          <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>
        )}
        {project && (
          <ScheduleTabsClient
            projectId={project.id}
            projectName={project.name}
            initialTab={initialTab}
            initialQuery={q ?? ""}
            timelineColumns={timelineColumns}
          />
        )}
      </div>
    </>
  );
}
