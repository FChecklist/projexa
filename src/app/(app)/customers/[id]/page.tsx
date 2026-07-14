import { AppTopbar } from "@/components/AppTopbar";
import CustomerOverviewClient from "@/components/CustomerOverviewClient";

type RouteParams = { params: Promise<{ id: string }> };

export default async function CustomerOverviewPage({ params }: RouteParams) {
  const { id } = await params;
  return (
    <>
      <AppTopbar title="Customer Overview" />
      <main className="flex-1 p-6">
        <CustomerOverviewClient customerId={id} />
      </main>
    </>
  );
}
