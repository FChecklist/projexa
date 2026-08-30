import ApplicationObjectClient from "@/components/ApplicationObjectClient";

export default async function ApplicationObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ApplicationObjectClient applicationId={id} />
    </div>
  );
}
