import { AppTopbar } from "@/components/AppTopbar";
import SalesDashboardClient from "@/components/SalesDashboardClient";

export default function SalesDashboardPage() {
  return (
    <>
      <AppTopbar title="Sales Dashboard" />
      <main className="flex-1 space-y-6 p-6">
        <SalesDashboardClient />
      </main>
    </>
  );
}
