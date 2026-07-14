import { AppTopbar } from "@/components/AppTopbar";
import InventoryClient from "@/components/InventoryClient";

export default function InventoryPage() {
  return (
    <>
      <AppTopbar title="Inventory" />
      <main className="flex-1 space-y-6 p-6">
        <InventoryClient />
      </main>
    </>
  );
}
