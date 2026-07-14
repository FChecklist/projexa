import { AppTopbar } from "@/components/AppTopbar";
import ProcurementClient from "@/components/ProcurementClient";

export default function ProcurementPage() {
  return (
    <>
      <AppTopbar title="Procurement" />
      <main className="flex-1 space-y-6 p-6">
        <ProcurementClient />
      </main>
    </>
  );
}
