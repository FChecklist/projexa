import { PageHeading } from "@/components/PageHeading";
import CustomerOverviewClient from "@/components/CustomerOverviewClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function CustomerOverviewPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <div className="flex-1 p-6">
        <PageHeading title="Customer Overview" />
        <CustomerOverviewClient customerId={id} />
      </div>
    </>
  );
}
