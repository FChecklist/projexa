import { PageHeading } from "@/components/PageHeading";
import PurchaseOrdersClient from "@/components/PurchaseOrdersClient";

export default function PurchaseOrdersPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Purchase Orders" />
        <PurchaseOrdersClient />
      </main>
    </>
  );
}
