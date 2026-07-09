import { AppTopbar } from "@/components/AppTopbar";
import FloorPlanEditorClient from "@/components/FloorPlanEditorClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function FloorPlanEditorPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <AppTopbar title="Floor Plan Editor" />
      <main className="flex-1 p-6">
        <FloorPlanEditorClient floorPlanId={id} />
      </main>
    </>
  );
}
