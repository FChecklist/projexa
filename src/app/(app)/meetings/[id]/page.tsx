import MeetingObjectClient from "@/components/MeetingObjectClient";

export default async function MeetingObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <MeetingObjectClient meetingId={id} />
    </div>
  );
}
