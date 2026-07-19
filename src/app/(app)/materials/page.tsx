import { PageHeading } from "@/components/PageHeading";
import MaterialsClient from "@/components/MaterialsClient";

export default function MaterialsPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Materials" />
        <MaterialsClient />
      </main>
    </>
  );
}
