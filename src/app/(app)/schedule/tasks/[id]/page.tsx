import ScheduleTaskObjectClient from "@/components/ScheduleTaskObjectClient";

// Real-screen conversion (2026-08-30): the Schedule module's first Object
// Page for its core "task" entity (pms_issues) -- previously there was no
// detail/edit screen at all. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
export default async function ScheduleTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ScheduleTaskObjectClient taskId={id} />
    </div>
  );
}
