import { PageHeading } from "@/components/PageHeading";
import AccountingClient from "@/components/AccountingClient";

export default function AccountingPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Accounting" />
        <AccountingClient />
      </div>
    </>
  );
}
