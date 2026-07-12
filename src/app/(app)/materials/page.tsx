import { AppTopbar } from "@/components/AppTopbar";
import MaterialsClient from "@/components/MaterialsClient";

export default function MaterialsPage() {
  return (
    <>
      <AppTopbar title="Materials" />
      <main className="flex-1 space-y-6 p-6">
        <MaterialsClient />
      </main>
    </>
  );
}
