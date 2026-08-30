import AccessReviewCycleObjectClient from "@/components/AccessReviewCycleObjectClient";

export default async function AccessReviewCycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <AccessReviewCycleObjectClient cycleId={id} />
    </div>
  );
}
