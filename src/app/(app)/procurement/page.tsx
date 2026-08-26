import { PageHeading } from "@/components/PageHeading";
import ProcurementClient from "@/components/ProcurementClient";

export default function ProcurementPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Procurement" />
        <ProcurementClient />
      </div>
    </>
  );
}
