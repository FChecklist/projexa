import SiteDiaryObjectClient from "@/components/SiteDiaryObjectClient";

export default async function SiteDiaryObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <SiteDiaryObjectClient diaryId={id} />
    </div>
  );
}
