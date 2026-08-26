import { PageHeading } from "@/components/PageHeading";
import InventoryClient from "@/components/InventoryClient";

export default function InventoryPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Inventory" />
        <InventoryClient />
      </div>
    </>
  );
}
