// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone and the frame streams first. The tab clients still fetch their own
// data (the four tabs read four different backends); per-tab loading is F-25.
//
// F_016 fix (2026-08-27) is preserved: isScheduleTab comes from
// src/lib/schedule-tabs.ts (a plain, non-"use client" module), NOT from
// ScheduleTabsClient.tsx. A function exported from a "use client" file becomes
// an opaque client reference when imported into a Server Component -- it can
// only be rendered or passed as a prop, never invoked -- and calling it here
// 500'd every GET /schedule in production (digest 1240219489).
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { SCHEDULE_TIMELINE_COLUMNS } from "@/lib/module-list-columns";
import { getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { ScheduleTabsClient } from "@/components/ScheduleTabsClient";
import { isScheduleTab } from "@/lib/schedule-tabs";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={SCHEDULE_TIMELINE_COLUMNS}
    tabs={["Timeline", "Board", "Sprints", "Timesheet"]}
  />
);

async function ScheduleSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const timelineColumns = await getScreenColumns("schedule.timeline", organizationId);
  const initialTab = isScheduleTab(tab) ? tab : "timeline";

  return (
    <>
      {/* The project's NAME is the one thing the fast path does not know. It
          gets its own boundary rather than delaying the tabs for a string. */}
      <Suspense fallback={<Skeleton className="h-6 w-56" />}>
        <ProjectNameHeading projectId={projectId} organizationId={organizationId} />
      </Suspense>
      <ScheduleTabsClient projectId={projectId} initialTab={initialTab} timelineColumns={timelineColumns} />
    </>
  );
}

async function ProjectNameHeading({ projectId, organizationId }: { projectId: string; organizationId: string | null }) {
  const name = await getProjectName(projectId, organizationId);
  if (!name) return null;
  return <h2 className="font-heading text-lg text-px-ink">{name}</h2>;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Schedule" />
      <Suspense fallback={SKELETON}>
        <ScheduleSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
