import { PageHeading } from "@/components/PageHeading";
import InvoicesClient from "@/components/InvoicesClient";

export default function InvoicesPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Invoices" />
        <InvoicesClient />
      </main>
    </>
  );
}
