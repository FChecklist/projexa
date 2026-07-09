import { AppTopbar } from "@/components/AppTopbar";
import FloorPlanWalkthroughClient from "@/components/FloorPlanWalkthroughClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function FloorPlanWalkthroughPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <AppTopbar title="3D Walkthrough" />
      <main className="flex-1 p-6">
        <FloorPlanWalkthroughClient floorPlanId={id} />
      </main>
    </>
  );
}
