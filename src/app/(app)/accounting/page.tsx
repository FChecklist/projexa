import { AppTopbar } from "@/components/AppTopbar";
import AccountingClient from "@/components/AccountingClient";

export default function AccountingPage() {
  return (
    <>
      <AppTopbar title="Accounting" />
      <main className="flex-1 space-y-6 p-6">
        <AccountingClient />
      </main>
    </>
  );
}
