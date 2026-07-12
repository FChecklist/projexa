import { AppTopbar } from "@/components/AppTopbar";
import VendorsClient from "@/components/VendorsClient";

export default function VendorsPage() {
  return (
    <>
      <AppTopbar title="Vendors" />
      <main className="flex-1 space-y-6 p-6">
        <VendorsClient />
      </main>
    </>
  );
}
