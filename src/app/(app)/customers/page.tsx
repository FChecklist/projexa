import { PageHeading } from "@/components/PageHeading";
import CustomersClient from "@/components/CustomersClient";

export default function CustomersPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Customers" />
        <CustomersClient />
      </main>
    </>
  );
}
