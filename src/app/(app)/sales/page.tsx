import { PageHeading } from "@/components/PageHeading";
import SalesDashboardClient from "@/components/SalesDashboardClient";

export default function SalesDashboardPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Sales Dashboard" />
        <SalesDashboardClient />
      </main>
    </>
  );
}
