// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale. /labour was one of the two worst offenders: two serial VERIDIAN
// hops (/dashboard, then /screen-definitions/manpower.list) before the first
// byte, and then three more client fetches -- about 6 s to a usable screen for
// SQL the audit measured as trivial. The frame now streams first and the
// roster, which is the tab this screen opens on, is fetched here on the server
// and handed to LabourClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { MANPOWER_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchRosterList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import LabourClient, { type RosterEntry } from "@/components/LabourClient";

const SKELETON = (
  <ModuleListSkeletonBody
    columns={MANPOWER_LIST_COLUMNS}
    tabs={["Roster", "Attendance"]}
    actions={["Add Worker"]}
  />
);

async function LabourSection({ requestedProjectId, tab }: { requestedProjectId?: string; tab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, roster] = await Promise.all([
    getScreenColumns("manpower.list", organizationId),
    fetchRosterList<RosterEntry>(organizationId, projectId, "the roster"),
  ]);

  return (
    <LabourClient
      projectId={projectId}
      registryColumns={registryColumns}
      initialTab={tab}
      initialRoster={roster}
    />
  );
}

export default async function LabourPage({ searchParams }: { searchParams: Promise<{ projectId?: string; tab?: string }> }) {
  const { projectId, tab } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Manpower & Attendance" />
      <Suspense fallback={SKELETON}>
        <LabourSection requestedProjectId={projectId} tab={tab} />
      </Suspense>
    </div>
  );
}
