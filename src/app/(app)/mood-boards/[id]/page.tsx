import MoodBoardObjectClient from "@/components/MoodBoardObjectClient";

export default async function MoodBoardObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <MoodBoardObjectClient boardId={id} />
    </div>
  );
}
