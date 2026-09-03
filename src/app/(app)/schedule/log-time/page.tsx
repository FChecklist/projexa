import { redirect } from "next/navigation";
import { resolveProjectIdFast } from "@/lib/module-list-source";

// R67 WS-H (item H-01). /schedule/log-time is now an ALIAS for the Design
// Studio's real create route, carrying ?taskId= through so a link from a task
// still lands with that task preselected.
//
// WHY AN ALIAS AND NOT A DELETE: this path is linked from the Schedule
// module's Timesheet tab and from any bookmark a designer already has, and a
// 404 on a URL that worked yesterday is worse than a redirect.
//
// ── MERGE NOTE (D-11 point 4): what is dropped here, and what is kept ────────
// Lane F2's item F-19 made this page resolve its project with NO network call
// -- the query string, else the projexa_project cookie the top rail writes --
// because the old version awaited getServerOrganizationId() and then a VERIDIAN
// /dashboard hop before emitting a byte (1.5-1.65 s to first byte for a form of
// five fields). That measurement and that fix are KEPT: resolveProjectIdFast()
// still runs here, and its answer rides into the redirect, so the create route
// arrives with the project already known and does not re-pay the hop. What is
// dropped is the SECOND log-time form -- src/components/ScheduleLogTimeClient.tsx
// -- because two create screens for one action is exactly how the two drift
// apart, which is the duplication item H-01 exists to end. Every behaviour lane
// D0 gave that component (its unswallowed task fetch, its in-place save failure
// with Retry, its bounded request) is carried into
// DesignStudioTimesheetCreateClient.tsx, which names each of them in its own
// header. Nothing is deleted silently: this comment, that header and the commit
// body all say what went and why.
export default async function ScheduleLogTimeAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; taskId?: string; issueId?: string }>;
}) {
  const { projectId, taskId, issueId } = await searchParams;
  const query = new URLSearchParams();
  // No network: the query string, else the cookie the top rail wrote (F-19).
  const known = await resolveProjectIdFast(projectId);
  if (known) query.set("projectId", known);
  // The Schedule module calls the same thing `issueId` on its own links;
  // both are accepted so neither caller has to be edited to keep working.
  const preselected = taskId ?? issueId;
  if (preselected) query.set("taskId", preselected);
  const suffix = query.toString();
  redirect(`/design-studio/timesheets/new${suffix ? `?${suffix}` : ""}`);
}
