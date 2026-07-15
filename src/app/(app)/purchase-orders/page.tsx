import { AppTopbar } from "@/components/AppTopbar";
import PurchaseOrdersClient from "@/components/PurchaseOrdersClient";

export default function PurchaseOrdersPage() {
  return (
    <>
      <AppTopbar title="Purchase Orders" />
      <main className="flex-1 space-y-6 p-6">
        <PurchaseOrdersClient />
      </main>
    </>
  );
}
