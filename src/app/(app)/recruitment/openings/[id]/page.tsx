import JobOpeningObjectClient from "@/components/JobOpeningObjectClient";

export default async function JobOpeningObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <JobOpeningObjectClient openingId={id} />
    </div>
  );
}
