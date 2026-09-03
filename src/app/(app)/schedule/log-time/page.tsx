// R67 F-19 (audit recommendation R-245) / decision D-04.
//
// This create route awaited getServerOrganizationId() and then a VERIDIAN
// /dashboard call BEFORE emitting a byte -- 1.5-1.65 s to first byte for a
// form of three to seven fields, against /budgets/new's 184 ms, which skips
// the chain. Every navigation that reaches this screen (a "+ New" button, a
// KPI tile, a pill) already carries ?projectId=, and the projexa_project
// cookie covers a typed or bookmarked URL, so the project is now resolved
// with NO network call and the form renders straight away. The /dashboard hop
// survives only for the case where neither source knows, and it happens inside
// a Suspense boundary behind the form's own skeleton.
import { Suspense } from "react";
import ScheduleLogTimeClient from "@/components/ScheduleLogTimeClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveProjectForModule, resolveProjectIdFast } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 D-51 + F-19. D-51 needs the project's NAME on the form -- "Project:
// <name> — change in the top bar" -- and F-19 forbids buying it with a
// blocking round trip. So the name is passed down whenever the server already
// has it for free (the cookie path resolves it while checking the id still
// belongs to this caller), and when it does not, the client looks it up itself
// after first paint. Either way the form names its project; only the moment it
// can do so differs, and no byte of TTFB is spent on it.
async function ResolvedForm({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <CreateProjectMissing message={errorMessage} />;
  return <ScheduleLogTimeClient projectId={projectId} projectName={projectName} />;
}

export default async function ScheduleLogTimePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  // No network: the query string, else the cookie the top rail wrote.
  const known = await resolveProjectIdFast(projectId);

  if (known) {
    return (
      <div className="flex-1">
        <ScheduleLogTimeClient projectId={known} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <Suspense fallback={<CreateFormSkeleton fields={5} />}>
        <ResolvedForm requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
