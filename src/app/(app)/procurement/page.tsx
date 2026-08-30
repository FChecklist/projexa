import { PageHeading } from "@/components/PageHeading";
import ProcurementClient from "@/components/ProcurementClient";

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Procurement" />
        <ProcurementClient initialTab={tab} />
      </div>
    </>
  );
}
