import { PageHeading } from "@/components/PageHeading";
import FloorPlanWalkthroughClient from "@/components/FloorPlanWalkthroughClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function FloorPlanWalkthroughPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <main className="flex-1 p-6">
        <PageHeading title="3D Walkthrough" />
        <FloorPlanWalkthroughClient floorPlanId={id} />
      </main>
    </>
  );
}
