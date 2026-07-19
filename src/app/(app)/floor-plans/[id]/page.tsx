import { PageHeading } from "@/components/PageHeading";
import FloorPlanEditorClient from "@/components/FloorPlanEditorClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function FloorPlanEditorPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <main className="flex-1 p-6">
        <PageHeading title="Floor Plan Editor" />
        <FloorPlanEditorClient floorPlanId={id} />
      </main>
    </>
  );
}
