import { AppTopbar } from "@/components/AppTopbar";
import PayrollClient from "@/components/PayrollClient";

export default function PayrollPage() {
  return (
    <>
      <AppTopbar title="Payroll" />
      <main className="flex-1 space-y-6 p-6">
        <PayrollClient />
      </main>
    </>
  );
}
