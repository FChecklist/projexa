import { AppTopbar } from "@/components/AppTopbar";
import CustomersClient from "@/components/CustomersClient";

export default function CustomersPage() {
  return (
    <>
      <AppTopbar title="Customers" />
      <main className="flex-1 space-y-6 p-6">
        <CustomersClient />
      </main>
    </>
  );
}
