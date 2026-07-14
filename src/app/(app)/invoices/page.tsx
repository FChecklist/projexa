import { AppTopbar } from "@/components/AppTopbar";
import InvoicesClient from "@/components/InvoicesClient";

export default function InvoicesPage() {
  return (
    <>
      <AppTopbar title="Invoices" />
      <main className="flex-1 space-y-6 p-6">
        <InvoicesClient />
      </main>
    </>
  );
}
