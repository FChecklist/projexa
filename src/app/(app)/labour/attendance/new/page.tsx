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
import AttendanceCreateClient from "@/components/AttendanceCreateClient";
import { CreateFormSkeleton, CreateProjectMissing } from "@/components/CreateFormSkeleton";
import { resolveProjectForModule, resolveProjectIdFast } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// R67 D-53: the Daily Summary's empty state links here for the day it was
// showing, so the form opens on THAT date rather than silently on today --
// otherwise the one click from "No attendance marked for 28-08-2026" would
// record the mark against the wrong day. A malformed value is ignored rather
// than forwarded, and the client then falls back to today.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(date: string | undefined): string | undefined {
  return date && ISO_DATE.test(date) ? date : undefined;
}

async function ResolvedForm({
  requestedProjectId,
  initialDate,
}: {
  requestedProjectId?: string;
  initialDate?: string;
}) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <CreateProjectMissing message={errorMessage} />;
  return <AttendanceCreateClient projectId={projectId} initialDate={initialDate} />;
}

export default async function LabourAttendanceNewPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; date?: string }>;
}) {
  const { projectId, date } = await searchParams;
  // No network: the query string, else the cookie the top rail wrote.
  const known = await resolveProjectIdFast(projectId);

  if (known) {
    return (
      <div className="flex-1 p-6">
        <AttendanceCreateClient projectId={known} initialDate={validDate(date)} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <Suspense fallback={<CreateFormSkeleton fields={5} />}>
        <ResolvedForm requestedProjectId={projectId} initialDate={validDate(date)} />
      </Suspense>
    </div>
  );
}
