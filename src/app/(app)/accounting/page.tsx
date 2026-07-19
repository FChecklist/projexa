import { PageHeading } from "@/components/PageHeading";
import AccountingClient from "@/components/AccountingClient";

export default function AccountingPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Accounting" />
        <AccountingClient />
      </main>
    </>
  );
}
