import { AppTopbar } from "@/components/AppTopbar";
import SalesOrdersClient from "@/components/SalesOrdersClient";

export default function SalesOrdersPage() {
  return (
    <>
      <AppTopbar title="Sales Orders" />
      <main className="flex-1 space-y-6 p-6">
        <SalesOrdersClient />
      </main>
    </>
  );
}
