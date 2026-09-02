import ScheduleTaskObjectClient from "@/components/ScheduleTaskObjectClient";
import { isScheduleTab } from "@/lib/schedule-tabs";

// Real-screen conversion (2026-08-30): the Schedule module's first Object
// Page for its core "task" entity (pms_issues) -- previously there was no
// detail/edit screen at all. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
//
// R67 lane D22 (item D-77, rec R-289): `?from=` carries the tab the click came
// from, so Back returns you to the Board you were reading rather than dumping
// you on Timeline (the module's default) and making you find your way back.
// Validated against the real tab list here, on the server, so a hand-typed
// ?from=anything cannot produce a URL that lands nowhere.
export default async function ScheduleTaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  return (
    <div className="flex-1">
      <ScheduleTaskObjectClient taskId={id} fromTab={isScheduleTab(from) ? from : null} />
    </div>
  );
}
