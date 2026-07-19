import { PageHeading } from "@/components/PageHeading";
import SalesOrdersClient from "@/components/SalesOrdersClient";

export default function SalesOrdersPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Sales Orders" />
        <SalesOrdersClient />
      </main>
    </>
  );
}
