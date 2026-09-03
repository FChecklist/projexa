import ScheduleTaskObjectClient from "@/components/ScheduleTaskObjectClient";

// Real-screen conversion (2026-08-30): the Schedule module's first Object
// Page for its core "task" entity (pms_issues) -- previously there was no
// detail/edit screen at all. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
//
// R67 D-44: `?backTo=` carries the list's own URL (project, tab and filter) so
// ← Back returns to /schedule exactly as the user left it, instead of a bare
// /schedule that re-resolves the project and drops the tab. It is validated
// here rather than trusted: only a path beginning "/schedule" is accepted, so
// the parameter can never be used to bounce a user off-site.
export default async function ScheduleTaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ backTo?: string }>;
}) {
  const { id } = await params;
  const { backTo } = await searchParams;
  const safeBackTo = backTo && /^\/schedule(\?|$)/.test(backTo) ? backTo : undefined;
  return (
    <div className="flex-1">
      <ScheduleTaskObjectClient taskId={id} backTo={safeBackTo} />
    </div>
  );
}
