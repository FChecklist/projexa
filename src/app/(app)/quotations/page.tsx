import { AppTopbar } from "@/components/AppTopbar";
import QuotationsClient from "@/components/QuotationsClient";

export default function QuotationsPage() {
  return (
    <>
      <AppTopbar title="Quotations" />
      <main className="flex-1 space-y-6 p-6">
        <QuotationsClient />
      </main>
    </>
  );
}
