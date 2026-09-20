// Cold-load fix (owner-flagged "single biggest risk to a live demo",
// PROJEXA-E2E-001 work order section 5): this page used to await
// resolveSelectedProject() directly with no <Suspense> boundary and no
// cache, so the WHOLE PAGE -- including the title -- blocked on an uncached
// upstream call, and MeetingsClient then fired a SECOND, separate client
// fetch after hydration. Two sequential VERIDIAN hops before anything
// useful was on screen, exactly the anti-pattern R67 F-18/F-30 already
// fixed on /labour, /reports, /documents and /budgets -- this route just
// never got the same treatment. See src/components/MeetingsClient.tsx's own
// header comment for the measured before/after numbers.
//
// Same shape as documents/page.tsx: the frame (title) streams first: the
// project resolution (now cached 30s, matching the module list's own 30s
// revalidate) and the meetings list are fetched together, server-side,
// inside ONE Suspense boundary, and the rows are handed to MeetingsClient as
// `initial` so it makes zero round trips on first paint.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { resolveSelectedProject } from "@/lib/project-selection";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { fetchMeetingsList } from "@/lib/module-list-source";
import MeetingsClient, { type Meeting } from "@/components/MeetingsClient";
import ProjectLoadError from "@/components/ProjectLoadError";

const SKELETON = (
  <div className="grid h-32 place-items-center" aria-busy="true">
    <Loader2 className="size-5 animate-spin text-px-muted" />
  </div>
);

async function MeetingsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  // R67 F-06/F-07/F-09 style caching: the project LIST is memoised 30s per
  // org, matching fetchMeetingsList's own tag revalidate window below. Which
  // project is SELECTED is still decided outside the cache on every call
  // (chooseProject(), see project-selection.ts), so switching project stays
  // instant and a cached list can never pin the wrong selection.
  const { project, errorMessage } = await resolveSelectedProject(requestedProjectId, organizationId, {
    cacheSeconds: 30,
  });

  if (errorMessage) return <ProjectLoadError message={errorMessage} />;
  if (!project) {
    return <Card><CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent></Card>;
  }

  const list = await fetchMeetingsList<Meeting>(organizationId, project.id, "meetings");

  return <MeetingsClient projectId={project.id} initial={list} />;
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Outside every boundary: painted at TTFB, whatever the backend does. */}
      <PageHeading title="Meetings" />
      <Suspense fallback={SKELETON}>
        <MeetingsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
