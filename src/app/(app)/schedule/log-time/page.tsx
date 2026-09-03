import { redirect } from "next/navigation";

// R67 WS-H (item H-01). /schedule/log-time is now an ALIAS for the Design
// Studio's real create route, carrying ?taskId= through so a link from a
// task still lands with that task preselected.
//
// WHY AN ALIAS AND NOT A DELETE: this path is linked from the Schedule
// module's Timesheet tab and from any bookmark a designer already has, and a
// 404 on a URL that worked yesterday is worse than a redirect. The old
// ScheduleLogTimeClient.tsx is REMOVED in the same commit rather than left
// behind unreferenced -- two log-time screens is exactly how the two drift
// apart, which is the duplication item H-01 exists to end. Nothing is
// deleted silently: this comment and that commit name what went and why.
export default async function ScheduleLogTimeAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; taskId?: string; issueId?: string }>;
}) {
  const { projectId, taskId, issueId } = await searchParams;
  const query = new URLSearchParams();
  if (projectId) query.set("projectId", projectId);
  // The Schedule module calls the same thing `issueId` on its own links;
  // both are accepted so neither caller has to be edited to keep working.
  const preselected = taskId ?? issueId;
  if (preselected) query.set("taskId", preselected);
  const suffix = query.toString();
  redirect(`/design-studio/timesheets/new${suffix ? `?${suffix}` : ""}`);
}
